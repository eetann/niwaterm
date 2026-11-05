---
type: ADR
title: "ADR 0009: WindowsのPTYは、同梱した新しいConPTYを中継プロセス経由で使う"
description: WindowsではOS標準のConPTYが子の出力を描き直すため、OSC 133のずれやAPCの欠落が起きる。Windows Terminalと同じ新しいConPTY（conpty.dll＋OpenConsole.exe）を同梱し、小さな中継exeを挟んでniwatermから使う意思決定
---

# ADR 0009: WindowsのPTYは、同梱した新しいConPTYを中継プロセス経由で使う

## Status

Accepted

## Context

niwatermのPTYは`Bun.Terminal`で作っている。Windowsでは`Bun.Terminal`がkernel32の`CreatePseudoConsole`（OS標準のConPTY）を呼ぶ。WSLのディストロを開くタブも、PowerShellのタブも、OS標準のConPTYを通る。

OS標準のConPTYは、子の出力をいったんconhostの画面バッファに描かせ、その結果をVTシーケンスに組み立て直してから流してくる。WSLのzshのように初めからVTシーケンスを出すプログラムでも、出力は一度描き直される。この描き直しが原因で、Windowsでだけ次の不具合が起きている。

- OSCは即座に素通しされるのに、文字は描き直してから流れる。そのため、全画面を描き直している最中に届いた`OSC 133;A`が、本来のプロンプトとは別の行に付く。p10kのinstant promptを使うと、最初のプロンプトへプロンプトジャンプで飛べない
- プロンプトより下の画面消去が`ESC[K\r\n`の繰り返しに書き換わる。libghostty-vtはプロンプト中の改行の次の行を継続行とみなすので、出力の行にまで継続行のマークが残る。libghostty-vtの`GHOSTTY_SCROLL_VIEWPORT_DELTA_PROMPT`は、この浮いた継続行に止まってしまう
- conhostが解釈できないAPCは捨てられる。Kitty graphicsの画像が表示されない（[既知の問題](/known-issues/windows-conpty-drops-kitty-graphics-apc.md)）

ConPTYは2024年に作り直されていて（microsoft/terminal PR #17510）、新しいConPTYはアプリが出したVTシーケンスに手を加えずに流す。ただし新しいConPTYが入っているのは、Windows Terminal 1.22以降が同梱する`conpty.dll`と`OpenConsole.exe`だけだ。Windows 11 25H2（ビルド26200）のOS標準のConPTYは、まだ描き直す方式で動いている。`conpty.dll`と`OpenConsole.exe`は、NuGetパッケージ`Microsoft.Windows.Console.ConPTY`としてMITライセンスで配布されている。

試作で、同じzsh（p10kのinstant prompt＋シェル統合）を両方のConPTYで起動して比べた。OS標準のConPTYでは実機と同じ不具合を再現した。同梱の`conpty.dll`では、行ごとのプロンプトマークがWSL内でzshを直接動かした場合と完全に一致した。

### 解決したい課題

- WSLのタブで、シェルが出したVTシーケンスをそのままlibghostty-vtへ届ける
- PowerShellやcmdなど、Windowsネイティブのシェルのタブでも同じ問題を起こさない
- 利用者に追加の導入作業（ディストロ側へのインストール等）を求めない

### 検討した選択肢

- A: OS標準のConPTYのまま使い、libghostty-vtへパッチを当てて、出力中の改行では行のプロンプトマークを外す
- B: wslbridge方式。WSLのディストロ側でLinuxのPTYを作ってシェルを起動し、バイト列をniwatermへ中継する（wsltty方式）
- C: 新しいConPTYを同梱し、Windowsのすべてのタブで使う

旧来のConPTYの素通しモード（`PSEUDOCONSOLE_PASSTHROUGH_MODE`）は、作り直しの際に無くなっているため候補にしていない。

### 各選択肢の評価

| 観点 | A: パッチ | B: wslbridge方式 | C: 新しいConPTYを同梱 |
|------|------|------|------|
| OSC 133のずれ（instant prompt） | 直らない | 直る | 直る |
| 浮いた継続行 | 直る | 直る | 直る |
| Kitty graphics（APC） | 直らない | WSLタブだけ直る | 直る |
| ネイティブのシェルのタブ | 継続行だけ直る | 対象外 | 直る |
| 利用者の導入作業 | なし | ディストロごとに中継プログラムが必要 | なし |
| niwatermが持つもの | libghostty-vtへのパッチ | Linux向けの中継プログラム・制御用の通信路 | 配布物2つ（約1.7MB）と中継exe |

## Decision

**Windowsでは新しいConPTY（`conpty.dll`＋`OpenConsole.exe`）をniwatermに同梱し、小さな中継exeを挟んで、すべてのターミナルタブで使う。**

選んだ理由は、ネイティブのシェルも含めた全タブの出力が正確になり、しかも利用者の導入作業が増えないからだ。Bで直るのはWSLのタブだけで、新しいConPTYでWSLの出力が素通しになる以上、Bならではの利点はほとんど消える。Aで直るのは浮いた継続行だけで、OSC 133のずれとAPCの欠落は残る。

### 1. 中継exeを挟む

`Bun.Terminal`は`conpty.dll`を使えない。そこでWindows専用の中継exeを用意し、niwatermからは`Bun.spawn`でパイプにつないで起動する。

```
niwaterm (Bun)
  │ stdin: 入力・リサイズを「種類＋長さ＋中身」で送る
  │ stdout: シェルの出力をそのまま受け取る
  ▼
中継exe ── conpty.dll ── OpenConsole.exe ── シェル（wsl.exe / pwsh / cmd）
```

中継exeは`conpty.dll`で疑似コンソールを作り、シェルを起動する。シェルの出力は中継exeの標準出力へそのまま流す。中継exeがどう終わっても、Jobオブジェクトでシェルごと終了させる。

`conpty.dll`をniwatermのプロセスへ直接読み込む形にはしない。直接読み込むと、出力を読むネイティブのスレッドからJSへコールバックすることになる。ところがElectrobunのアプリコードが動くBun Workerでは、ネイティブのコールバックが発火しないことがある。別プロセスにしておけば、出力は今も使っている`Bun.spawn`のパイプで受け取れる。

### 2. 配布物は版を固定して取得する

`conpty.dll`と`OpenConsole.exe`はリポジトリに入れず、libghostty-vtと同じく`vendor/`（gitignore済み）へmiseのタスクで取得する。NuGetパッケージの版は`mise.toml`の`[vars]`で固定し、上げるときは意図して上げる。

### 3. 取得していない環境では今の`Bun.Terminal`で動かす

中継exeや`conpty.dll`が見つからないときは、今まで通り`Bun.Terminal`（OS標準のConPTY）で起動する。macOSは今のまま変えない。

## Consequences

### Positive

- WSLのタブでも、PowerShellやcmdのタブでも、シェルが出したVTシーケンスがそのまま届く。OSC 133のプロンプトマークがmacOSと同じように付き、Kitty graphicsも届くようになる
- プロンプトジャンプを`GHOSTTY_SCROLL_VIEWPORT_DELTA_PROMPT`へ置き換えられる
- Windows Terminalと同じConPTYを使うので、今後のConPTYの改善を版の更新だけで取り込める

### Negative

- Windowsのタブごとに、中継exeとOpenConsole.exeの2プロセスが増える
  - → どちらも入出力を流すだけの軽いプロセスで、Windows Terminalも1タブにつきOpenConsole.exeを1つ起動している
- 中継exeの入出力・リサイズ・終了処理を自前で持つことになる。`Bun.Terminal`が肩代わりしていた部分だ
  - → 中継exeの役割を入出力の中継とリサイズに限り、シェルの起動方法や環境変数の組み立ては今の`pty.ts`に残す
- 新しいConPTYにも改変が2つ残る。設定次第でLFをCRLFへ広げることと、フォーカスイベントを出力の途中へ差し込むことだ
  - → WSLの出力はLinux側の端末設定で既にCRLFになっているため、前者の影響は出ない見込み。後者は今のOS標準のConPTYでも同じ

### Risks

- 新しいConPTYは起動時に端末へ問い合わせ（DA1など）を送る。応答が返らないと、起動を待たされる実装の可能性がある
  - → libghostty-vtがDA1へ応答し、niwatermがその応答をPTYへ書き戻す今の仕組みで返るかを、実装時に確かめる
- OS標準のConPTYが新方式へ更新されれば、同梱する理由は薄れる
  - → そのときは同梱をやめて`Bun.Terminal`へ戻すかを判断する。中継exeは`pty.ts`の内側に閉じているので、戻すのは容易

## 決めていないこと

| 項目 | 決めない理由 | いつ決めるか |
|------|------------|------------|
| libghostty-vtへのパッチ（選択肢A）を併用するか | 同梱できない環境で、OS標準のConPTYへ戻ったときにだけ意味がある。新しいConPTYでの実用上の効果を見てから判断したい | 新しいConPTYへの切り替えを実機で使ってみた後 |
| 配布用パッケージへの組み込み方 | niwatermはまだdevモードでの起動だけを前提にしている | 配布用パッケージを作るとき |

## Notes

### 参考資料

- microsoft/terminal PR #17510（ConPTYの作り直し）: https://github.com/microsoft/terminal/pull/17510
- microsoft/terminal issue #1173（ConPTYの素通しモード）: https://github.com/microsoft/terminal/issues/1173
- NuGet `Microsoft.Windows.Console.ConPTY`: https://www.nuget.org/packages/Microsoft.Windows.Console.ConPTY
- [Windows実機: OS標準のConPTYがAPCシーケンスを捨てるため、Kitty graphicsの画像が表示されない](/known-issues/windows-conpty-drops-kitty-graphics-apc.md)
