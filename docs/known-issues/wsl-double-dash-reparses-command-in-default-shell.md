---
type: Known Issue
title: "wsl.exeの`--`以降は既定シェルで再解釈され、commandの$展開が先に潰れる"
description: wsl.exeは`--`より後ろのコマンドラインをユーザーの既定シェルにもう一度解釈させてから実行する。WSLシェルでレイアウトのcommand（closeOnExit）やポップアップのコマンドを渡すと、`$var`・`$(...)`・`"$@"`がbashへ届く前に外側のシェルで展開されてしまう。`-e`（--exec）なら既定シェルを通らない
---

# wsl.exeの`--`以降は既定シェルで再解釈され、commandの$展開が先に潰れる

## 症状

既定シェルがWSL（`wsl.exe -d NixOS`など）のとき、`closeOnExit: true`のレイアウトタブや
ポップアップで実行するコマンドが、書いたとおりに動かない。

例として、次のcommandを持つeditpromptタブでは、claudeタブが存在していても毎回`--target-pane`なしで起動した。
editprompt側で`Current pane is not an editor pane`のエラーになる。

```sh
ep() { node "$HOME/.../dist/index.js" open --editor nvim "$@"; }; target=$(niwa tab var find role claude | head -n1); [ -n "$target" ] && ep --target-pane "$target" || ep
```

タブ内のzshが実際に受け取った`-c`の文字列は、次のように展開済みになっていた。

```sh
ep() { node "/home/eetann/.../dist/index.js" open --editor nvim ""; }; target=; [ -n "" ] && ep --target-pane "" || ep
```

`$(...)`は外側のシェルで実行され、`$target`も外側で空文字に置き換わる。そのため`[ -n "" ]`は常に偽になる。
`"$@"`も`""`になるので、空の引数が1つ余分に渡る。`$`を含まないコマンド（`ghq list | fzf`など）は
展開される箇所が無いので、問題が表に出ない。

## 原因

wsl.exeは`--`より後ろを「コマンドラインをそのまま渡す」指定として扱い、ユーザーの既定シェル
（`/etc/passwd`のログインシェル）に`-c`で解釈させてから実行する。

niwatermは`wsl.exe ... -- bash -c 'exec "$SHELL" -l -i -c '<command>''`の形でcommandを渡していた。
Windowsでは`Bun.spawn`がargvをコマンドライン文字列へ組み立てる際に、空白を含む引数をダブルクォートで包む。
既定シェルから見ると`bash -c "exec \"$SHELL\" ... -c '<command>'"`というダブルクォート文字列になり、
内側のシングルクォートは保護として効かない。結果として、commandの中身はbashへ届く前に既定シェルで展開される。

WSLからの次の実験で確かめられる。

```sh
wsl.exe -d NixOS -- bash -c "printf '<%s>\n' '\$HOME'"   # </home/eetann>（展開された）
wsl.exe -d NixOS -e bash -c "printf '<%s>\n' '\$HOME'"   # <$HOME>（そのまま）
```

## 対処

`src/bun/pty.ts`の`appendCommandArgs`で、`--`の代わりに`-e`（`--exec`）を使う。
`-e`は既定シェルを通さずに直接execするので、展開は内側の`$SHELL -l -i -c`での1回だけになる。
`--cd`は従来どおり`-e`より前に置く必要がある（`-e`より後ろはLinux側のコマンドの引数になる）。

同じ関数を通る経路（レイアウトの`closeOnExit`タブ、ポップアップ、`niwa.shell.run`）がまとめて直る。
