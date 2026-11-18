---
type: Known Issue
title: "macOS: .appから起動するとタブのシェルにロケール変数が無く、lsが日本語を?で表示する"
description: Finder・Dockから起動した.appはログインシェルを経由しないためLANG等のロケール変数を持たない。そのままタブへ渡すとlsなどが非ASCIIのファイル名を?に置き換えて表示する。ロケール変数が1つも無いときだけ、macOSの言語・地域設定からLANGを補って回避する
---

# macOS: .appから起動するとタブのシェルにロケール変数が無く、lsが日本語を?で表示する

## 症状

macOSのniwatermのタブで`ls`すると、日本語のファイル名が`?????????.txt`のように半角の`?`で表示される。
タブ内で`echo "[$LANG][$LC_ALL][$LC_CTYPE]"`するとすべて空になっている。

## 原因

Finder・Dock・`open`で起動した.appはLaunchServices経由で起動するため、`~/.zshrc`等が読まれず
`LANG`・`LC_ALL`・`LC_CTYPE`を持たない。niwatermはアプリのprocess.envを元にタブのシェルの環境変数を
作るので、タブにもロケール変数が無いまま渡る。ロケールがCのままだと、macOSの`ls`は端末へ出力するときに
表示できないバイトを`?`へ置き換える（パイプへの出力では置き換えないので`ls | cat`だと正しく見える）。

Terminal.app・iTerm2・Ghosttyも同じ理由で、起動時に`LANG`を自前で設定している。

## 回避策

`src/bun/macos-locale.ts`で、タブの環境変数にロケール変数が1つも無いときだけ`LANG`を補う。

- 値はmacOSの言語・地域設定（`defaults read -g AppleLocale`、例: `ja_JP`）に`.UTF-8`を付けたもの
- `en_JP`のように対応するPOSIXロケールが無い組み合わせは`/usr/share/locale`で実在を確かめ、無ければ`en_US.UTF-8`
- ユーザーが`LC_*`で上書きできるよう、`LC_ALL`ではなく`LANG`を使う

ユーザーの環境に既にロケール変数がある場合（ターミナルから`mise run start`した等）は触らない。

## 再現

```sh
mkdir -p /tmp/jp && touch /tmp/jp/日本語.txt
# 端末への出力が必要なのでscriptで擬似端末を挟む
script -q /dev/null env -u LANG -u LC_ALL -u LC_CTYPE ls /tmp/jp   #=> ?????????.txt
script -q /dev/null env -u LC_ALL -u LC_CTYPE LANG=ja_JP.UTF-8 ls /tmp/jp   #=> 日本語.txt
```

## 関連

- [pbcopy/pbpasteのロケール問題](./macos-pbcopy-needs-utf8-locale.md) — 同じ原因でクリップボードが化ける
