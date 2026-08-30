---
type: Known Issue
title: "macOSではOptionキー付きのキーバインドがそのままでは発火しない"
description: macOSのOption+英数字はe.keyが別文字・デッドキーになり、さらにkeyCode 229でIME入力として通知されるため、alt+nのようなdirectバインドが素直には一致しない。e.codeへのフォールバックとIMEガードの除外で対応している。
---

# macOSではOptionキー付きのキーバインドがそのままでは発火しない

`niwa.keybind("alt+n", "next-board", { noPrefix: true })` のような
tmuxの`bind-key -n M-n`相当のバインドは、Windowsでは素直に動くがmacOSでは
2つの理由で一度も発火しない。実機（macOS 15、日本語入力ソース有効）で確認済み。

## 症状

Optionを押しながらの英数字キーが、キーバインドとして認識されない。
ターミナルへは`π`のような別文字がそのまま入力される（`alt+p`の場合）か、
何も起きない（`alt+n`の場合）。

## 原因1: Optionは「修飾」ではなく「別の文字の入力」

macOSのOptionキーは修飾キーではなく代替文字の入力として扱われるため、
`KeyboardEvent.key`が元の文字にならない。US配列での実測値:

| 押したキー | `e.key` | `e.code` | `e.altKey` |
|---|---|---|---|
| Option+P | `"π"` | `KeyP` | `true` |
| Option+J | `"∆"` | `KeyJ` | `true` |
| Option+N | `"˜"`（デッドキー） | `KeyN` | `true` |

`src/mainview/tile-keybindings.ts`の`keyBodyFromEvent`は既定で`e.key`を見るため、
`"π"`は`alt+p`のバインドに一致しない。

**対応**: `e.altKey`が立っている時だけ、物理キー位置の`e.code`（`KeyP`→`p`、
`Digit1`→`1`）から文字を復元する。英数字キーはJIS/US等の主要配列で位置が
共通なので配列差の影響を受けにくい。記号キーは配列でずれるため対象にしていない。

## 原因2: デッドキーはIME入力として通知される

Option+N（`˜`）やOption+E（`´`）のようなデッドキーは、keydownが
`keyCode === 229`（WebKitのIME通知）で飛んでくる。`src/mainview/index.ts`の
keydownリスナ冒頭にあるIMEガードがこれを早期returnで捨てるため、
キーバインド解決まで到達しない。原因1だけを直しても`alt+n`は動かない。

**対応**: `e.altKey`が立っているkeydownはIMEガードの対象から外す
（`e.isComposing`の判定は残す）。Alt付きのキーがIMEの変換入力になることは
実用上ないため、変換中の挙動は壊れない。

## 切り分けのコツ

webviewのconsole.logはメインプロセスのstdoutに出ないため、
keydownの中身が知りたい時はkeydownリスナから`sendMessage("input", ...)`で
ターミナルへ直接ダンプを流し込み、`niwaterm tab capture`で読むのが速い。
`e.key` / `e.code` / `e.altKey` / `e.keyCode`と、
webview側が受け取っているキーバインド表（`lastKeybindingsConfig.direct`のキー一覧）を
同時に出すと、「キーが届いていない」のか「バインドが届いていない」のかを一度に切り分けられる。
