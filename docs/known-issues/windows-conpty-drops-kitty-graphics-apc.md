---
type: Known Issue
title: "Windows実機: ConPTYがAPCシーケンスを捨てるため、Kitty graphicsの画像が表示されない"
description: WindowsのPTY（ConPTY）は子プロセスの出力を自前の画面バッファで解釈し直してから再出力するため、APC（ESC _）で送られるKitty graphics protocolのシーケンスが丸ごと消える。WSLタブ・Windowsネイティブのシェルのどちらでも、niwatermへ届く時点で画像のデータが無い。macOSでは表示できる
---

# Windows実機: ConPTYがAPCシーケンスを捨てるため、Kitty graphicsの画像が表示されない

## 症状

Windows実機で`kitten icat`等からKitty graphics protocolの画像を出しても何も表示されない。
画像の分だけカーソルが下がることもなく、画像を送らなかったのと同じ見た目になる。
WSLディストロのタブでも、PowerShellのタブでも同じ。

## 原因

**ConPTYが子プロセスの出力を素通しせず、APC（`ESC _ ... ESC \`）を捨てる。**
ConPTYは子の出力をいったん自分の画面バッファ（conhost）へ解釈させ、その結果を
VTシーケンスとして組み立て直して親（niwaterm）へ流す。conhostが知らないAPCは
画面バッファに残らないため、再出力にも現れない。

Kitty graphics protocolの画像はAPCで送られるので、niwatermの`Bun.Terminal`
（Windowsでは内部でConPTYを使う）が受け取る時点で消えている。libghostty-vtと
niwatermの描画処理（`src/bun/ghostty.ts`の`kittyGraphics`、`src/mainview/kitty-images.ts`）までは
届かないので、niwaterm側の実装では直せない。

## 確認方法

Windows側で`Bun.Terminal`越しに画像を出すスクリプトを動かし、受け取ったバイト列に
`ESC _`が含まれるかを数える。WSL経由（`wsl.exe -d NixOS -- bun kitty-demo.ts`）と
Windowsネイティブ（`bun kitty-demo.ts`）のどちらも0件で、前後の通常の文字列だけが
（ConPTYが組み立て直した形で）届く。

## 対処

現状は未対応。Windowsで画像を出すには、ConPTYを経由しない経路が要る。

- WSLタブはLinux側でPTYを持ち、中身をパイプでniwatermへ運ぶ中継（wsltty の wslbridge と同じ方式）
- ConPTY自体を素通しモードで動かす（OS標準のConPTYでは使えない）
