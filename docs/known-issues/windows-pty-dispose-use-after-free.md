---
type: Known Issue
title: "Windows実機: PTY終了直後のdispose()でuse-after-freeクラッシュ"
description: PTYプロセス終了直後にGhosttyTerminalを解放すると、非同期に遅延発火するdataコールバックが解放済みハンドルへ書き込みuse-after-freeでクラッシュする。原因の切り分け・再現条件・対処方法を記録する
---

# Windows実機: PTY終了直後のdispose()でuse-after-freeクラッシュ

## 症状

Windows実機（Bun 1.3.14）で、PTYへの書き込み内容が「何か出力を伴うコマンド」＋「その直後にシェルを終了させる」という組み合わせになると、`panic(thread ...): Segmentation fault`でniwatermアプリ自体（Bunプロセス）がクラッシュすることがある。`tab send-keys`・`niwaterm.config.ts`のレイアウトプリセットの`command`・popupの`command`実行など、PTYへ書き込みを行う機能全般が対象になりうる。

## 根本原因

`Bun.Terminal`の`data`コールバックは、PTYプロセスの`onExit`発火後にも非同期に発火することがある（最小構成での実測で約6割の頻度）。この状態でniwaterm側の`terminal-session.ts`が`dispose()`（`pty.kill()` + `term.free()`）を同期的に呼んでGhosttyTerminal（libghostty-vt）のネイティブハンドルを解放してしまうと、その後に発火した`data`コールバックが解放済みハンドルへ`term.write()`し、**use-after-free**でクラッシュする。

当初は「`;`区切りで出力を伴うコマンドの直後にexitが続く場合にのみ発生する」という条件で観測していたが、これは表面上の再現しやすさの違いにすぎない。実際には「PTYプロセスのonExit直後に同期的に`dispose()`を呼ぶ」経路全般（`workspace.ts`の`handleTabProcessExit`が最後のタブを閉じる場合など）に共通する非決定的なrace conditionであり、`;`区切りかどうかは本質的な条件ではない。

## 切り分けの経緯

以下の構成を順に試し、再現するかを確認した（Windows実機、Bun 1.3.14、`"echo hello; exit\r"`を送信）。

| 構成 | 試行回数 | 結果 |
| --- | --- | --- |
| メインスレッド単体の`Bun.Terminal`（niwatermコード不使用） | 8回 | 再現せず |
| Bun Worker内の`Bun.Terminal` | 6回 | 再現せず |
| 大量出力（2000行）を伴う`;`+exit | 1回 | 再現せず |
| 実際の`pty.ts`+`ghostty.ts`(libghostty-vt FFI)+`terminal-session.ts`統合。ただし`onExit`は単なるログのみ | 10回 | 再現せず |
| 上記統合を複数PTY同時起動した状態で実行 | 4回 | 再現せず |
| 実際のniwatermアプリ（Electrobun、`BrowserWindow`+RPC+IPCサーバー込み）にCLIの`tab send-keys`で送信。ただし`onExit`は単なるログのみ | 1回 | 再現せず |
| 上記に加え`onOutput`内でRPC経由のレンダリング送信（`scheduleRender`相当）を追加 | 1回 | 再現せず |
| 上記に加え`onExit`内で`session.dispose()`（`pty.kill()`+`term.free()`）を同期的に呼ぶ | 1回 | **再現した**（Electrobunなし） |
| Electrobunを除いた単体スクリプトで`onExit`内`session.dispose()`のみ再試行 | 1回 | **再現した** |
| `Bun.Terminal`単体で`onExit`内`terminal.close()`のみ（libghostty-vt不使用） | 6回 | 再現せず |
| libghostty-vt単体で`onExit`内`term.free()`のみ（PTYは`close()`しない） | 5回 | **2回再現**（非決定的） |
| 上記に`data`コールバック内`disposed`フラグガードを追加 | 12回 | 再現せず（「dispose後にdataコールバックが発火した」ことは7回ログで確認、書き込みはガードでスキップ） |

Electrobun/webview/RPC/IPCサーバーは再現に一切必要なく、**「`term.free()`（またはそれを含む`dispose()`）をPTY終了直後に同期的に呼ぶ」という条件だけで、非決定的に（実測5回中2回程度）再現する**ことが分かった。逆に`data`コールバックへ1行のガードを入れるだけで、同じ条件を12回試しても再現しなくなった。

当初は[oven-sh/bun#29522](https://github.com/oven-sh/bun/pull/29522)（`Bun.Terminal`のWindows ConPTY実装）側のrace conditionを疑っていたが、`Bun.Terminal`単体（`terminal.close()`のみ、libghostty-vt不使用）では一切再現しなかったため、**Bun本体単独のバグではなく、niwaterm側がuse-after-freeを踏んでいた**というのが最終的な結論。

## 対処方法

`src/bun/terminal-session.ts`の`pty.onData`コールバックに`disposed`状態のガードを追加する。`dispose()`が呼ばれた後に発火した`data`イベントは、GhosttyTerminal（libghostty-vt）への書き込みを行わず無視する。

```ts
let disposed = false;

pty.onData((data) => {
  if (disposed) return;
  term.write(data);
  opts.onOutput?.();
});

function dispose(): void {
  if (disposed) return;
  disposed = true;
  try {
    pty.kill();
  } catch {}
  term.free();
}
```

これまで採用していた「`;`でコマンドを連結せず改行で分けて送信する」という回避策（popupの`command`実行）は、この根本原因に対する対症療法にすぎない。ガード追加後は`;`区切りでも安全になる見込みだが、対話的フルスクリーンTUI（lazygit等）でワンショット実行の`exit`が意図しない入力として扱われる問題（[CLIリファレンス](/guide/cli.md)「niwa popup」参照）は別の不具合であり、このガードでは解決しない。

## 関連

- [Windowsでのビルド・実行手順](/build/windows-build.md) — 実機セットアップ手順
- [CLIリファレンス](/guide/cli.md) — `niwa popup`の既知の制約
- `src/bun/terminal-session.ts` — `dispose()` / `pty.onData`
- `src/bun/pty.ts` — `kill()`（`terminal.close()` + `proc.kill()`）
- `src/bun/ghostty.ts` — `free()`（`ghostty_terminal_free`）
- [oven-sh/bun#29522](https://github.com/oven-sh/bun/pull/29522) — `Bun.Terminal`のWindows ConPTY実装（直接の原因ではなかったが、調査の出発点になったPR）
