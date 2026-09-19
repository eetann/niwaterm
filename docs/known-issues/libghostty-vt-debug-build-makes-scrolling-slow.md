---
type: Known Issue
title: "macOS: libghostty-vtのDebugビルドでスクロールが1行700µsになる"
description: zigの既定最適化レベルはDebugで、Debugビルドのlibghostty-vtはPageList.growのたびにPage.verifyIntegrityが走るため画面スクロール1行あたり約700µsかかる。PTY読み取りのイベントループが数百ms単位で止まり、描画が「引っ掛かる」原因になる
---

# macOS: libghostty-vtのDebugビルドでスクロールが1行700µsになる

## 症状

macOSでのみ描画が滑らかでなく、スクロールに引っ掛かりが出る。同じコードをWindows実機で
動かすと起きない。再現例は `nvim` で長いファイルを開き `<C-D>` / `<C-U>` でスクロールし続ける操作。

体感としては「コマ落ち」で、ターミナルの表示自体は壊れない。

## 原因

`vendor/libghostty/lib/libghostty-vt.dylib` が **Debugビルド**になっている。

zigの `zig build` は `-Doptimize` を省略すると `Debug` になる。Debugビルドのlibghostty-vtは
画面をスクロールするたびに走る `PageList.grow` の中で `Page.verifyIntegrity`
（ページ全体を走査してデータ構造の不変条件を検査するデバッグ用ルーチン）を実行するため、
スクロール1行のコストが桁違いに大きくなる。

`sample` で取ったコールグラフ:

```
ghostty_terminal_vt_write
  terminal.Terminal.linefeed
    terminal.Terminal.index
      terminal.Screen.cursorScrollAbove
        terminal.Screen.cursorDownScroll
          terminal.PageList.grow
            terminal.page.Page.verifyIntegrity   ← ここが支配的
```

実測値（M4 Pro / 200桁×50行）:

| 操作                             | Debug     | ReleaseFast |
| -------------------------------- | --------- | ----------- |
| 2000行スクロール                 | 約1450ms  | 0.1ms       |
| nvimの`<C-D>`実出力264KBの流し込み | 約3800ms  | 1〜2ms      |

コストは桁数・行数・スクロールバック上限のいずれにも比例せず、スクロール1回あたり
約700µsの定数として効く。

この経路を通るのは**プライマリ画面のスクロールだけ**で、代替画面（alt screen）内の
スクロールは `PageList` を伸ばさないため影響を受けない。nvimは代替画面で動くが、
起動前後のシェル出力・`:terminal`・プライマリ画面へ戻った後の描画は直撃する。

### なぜmacOSでだけ起きるか

Windows向けビルドは `mise run build:vendor:win` に `-Doptimize=ReleaseFast` が入っている
一方、macOS向けの手順にはこのフラグが無く、Debugビルドが `vendor/` に入っていた。
プラットフォーム差ではなくビルド設定の差。

### なぜ気づきにくいか

`term.write` が遅いとPTYのdataコールバック内で時間を使い切るため、症状は
「Bunワーカーのイベントループ全体が止まる」という形で現れる。描画のコアレス用
`setTimeout(16)` が数百ms遅れて発火するため、webview側の描画処理やRPC転送を
いくら調べても原因が見つからない。切り分けには `term.write` 自体の所要時間を
測るのが近道。

## 対処

`-Doptimize=ReleaseFast` を付けてビルドし直す。手順はタスク化してある。

```sh
mise run build:vendor:mac
mise run build:native   # ヘッダが変わっているのでシムも作り直す
```

## 関連するハマりどころ: dylib差し替え時のコード署名

同じパスのdylibを上書きすると、dyldが記憶しているadhoc署名と一致せず、
`dlopen` の時点で `SIGKILL (Code Signature Invalid)` でプロセスごと落ちる。
クラッシュレポートには `EXC_BAD_ACCESS` / `termination: CODESIGNING` と出る。

`mise run build:vendor:mac` はビルド後に `codesign -f -s -` で署名し直すため
このタスク経由なら踏まない。手でdylibを差し替える場合は署名し直すこと。
