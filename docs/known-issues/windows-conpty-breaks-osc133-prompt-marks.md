---
type: Known Issue
title: "Windows実機: OS標準のConPTYを通すと、OSC 133のプロンプトマークがずれる"
description: OS標準のConPTYは子の出力を描き直してから流し、OSCだけを先に素通しする。そのため最初のプロンプトにマークが付かず、出力の行に継続行のマークが残って、プロンプトジャンプが飛べなかったり出力の途中に止まったりする。同梱した新しいConPTYを使えば起きない
---

# Windows実機: OS標準のConPTYを通すと、OSC 133のプロンプトマークがずれる

## 症状

Windows実機のタブで、プロンプトジャンプ（prefix + shift+up/down、コピーモードの`{` `}`）がおかしくなる。

- 新しいタブを開いた直後の最初のプロンプトへ飛べない。p10kのinstant promptを使っていると起きる
- `GHOSTTY_SCROLL_VIEWPORT_DELTA_PROMPT`でジャンプすると、最初のコマンドの出力の途中や入力行に止まる

macOSや、WSL内でzshを直接動かした場合は起きない。

## 原因

OS標準のConPTYは、子の出力をいったんconhostの画面バッファに描かせ、その結果をVTシーケンスに組み立て直して流す。ところがOSCだけは即座に素通しするので、文字との前後関係が崩れる。これが2つの形で表れる。

1. **`133;A`が別の行に付く。** instant promptの仮のプロンプトを消すとき、ConPTYは画面全体を描き直してカーソルを最下行へ置く。そこへシェルの`133;A`が届くと、マークは最下行に付く。その後に描き直された本物のプロンプトの行には付かない
2. **出力の行に継続行のマークが残る。** ConPTYは、プロンプトより下を消す処理を`ESC[K\r\n`の繰り返しに書き換えて流す。libghostty-vtはプロンプト中の改行の次の行を継続行とみなすので、下の空行がすべて継続行になる。しかもこのマークは、出力で上書きされても消えない（消すのは、`133;C`を受けた行のカーソルが0桁目にあるときだけ）。2はinstant promptを使っていなくても、新しいタブや`clear`の直後のように、プロンプトが画面の途中にあれば起きる

`findPrompt`（`src/bun/ghostty.ts`）は`PROMPT`の行しか拾わないので、2の影響をほぼ受けない。`DELTA_PROMPT`は、`PROMPT`の行を伴わない継続行を「スクロールバックで1行目が消えたプロンプト」とみなして止まる。

## 確認方法

`pty.onData`で受け取ったバイト列をファイルへ書き出し、`createGhosttyTerminal`へ流し直して行ごとの`GHOSTTY_ROW_DATA_SEMANTIC_PROMPT`を並べる。OS標準のConPTYを通した場合は、最初のプロンプトの行が`NONE`、その下が`PROMPT_CONTINUATION`になり、`ESC[K\r\n`が数百個含まれる。

## 対処

niwatermはWindowsで、同梱した新しいConPTY（`conpty.dll`＋`OpenConsole.exe`）を中継exe経由で使う。新しいConPTYは子の出力を描き直さないので、マークはmacOSと同じように付く（[ADR 0009](/adr/0009-bundle-new-conpty-via-relay-process-on-windows.md)）。

`mise run build:native`をまだ実行していないなど、中継exe・`conpty.dll`・`OpenConsole.exe`のどれかが無い環境ではOS標準のConPTYへ戻り、この問題が起きる。
