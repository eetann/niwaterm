---
type: Known Issue
title: "macOS: pbcopy/pbpasteはロケール未設定だと非ASCIIが化ける・空になる"
description: pbcopy/pbpasteは読み書きするエンコーディングをロケール環境変数から決めるため、ロケールを持たない.appから起動すると日本語などの非ASCIIがShift_JISとして解釈されて文字化けし、非ASCIIだけの文字列はクリップボードが空になる。Bun.spawn時にLC_ALLでUTF-8を明示して回避する
---

# macOS: pbcopy/pbpasteはロケール未設定だと非ASCIIが化ける・空になる

## 症状

macOSのniwatermで、マウスのドラッグ選択・コピーモードのヤンク・OSC 52のいずれでコピーしても、
日本語を含むテキストが正しくクリップボードへ入らない。症状は内容によって2通りに分かれる。

- ASCIIと非ASCIIが混ざったテキスト（`abc日本語def`）→ `abc譌･譛ｬ隱枦ef` のように文字化けする
- 非ASCIIだけのテキスト（`日本語`）→ **クリップボードが空になる**（何も貼り付けられない）
- ASCIIだけのテキスト（`hello`）→ 正常

ペースト側（`pbpaste`）も同様で、日本語を含むクリップボードの内容が化けて貼り付けられる。

## 原因

**`pbcopy`/`pbpaste`は読み書きするエンコーディングをロケール環境変数（`LC_ALL`・`LC_CTYPE`・`LANG`）から決める。**
未設定だとUTF-8ではなくシステム既定のエンコーディング（日本語環境ではShift_JIS）を使うため、
niwatermが渡したUTF-8バイト列がShift_JISとして解釈される。混在テキストで化け方が「UTF-8をShift_JISで開いた」
典型的なパターンになるのはこのため。非ASCIIだけの文字列で空になるのは、変換に失敗して
ペーストボードへ何も書き込まれないから。

そして**GUIアプリはロケール環境変数を持たない**。`.app`はログインシェルを経由せず
LaunchServices経由で起動するため`~/.zshrc`等が読まれない。ユーザーが`LANG`を明示的に
設定していない環境では、ターミナルから`mise run start`で起動した場合も同じく未設定のまま子へ継承される。

## 対応

`src/bun/clipboard.ts`で`pbcopy`/`pbpaste`を`Bun.spawn`する際に`LC_ALL: "en_US.UTF-8"`を渡す。
`LC_CTYPE`や`LANG`ではなく`LC_ALL`を使うのは、`LC_ALL`が他のロケール変数より優先されるため。
ユーザー環境側に`LC_ALL=ja_JP.eucJP`のような設定があっても上書きできる（逆に`LC_CTYPE`だけ指定しても
既存の`LC_ALL`に負ける）。

## 切り分けの証拠

ロケール変数を持たないシェルから直接叩くと再現する。

```sh
# 化ける: 混在テキスト
env -u LANG -u LC_ALL -u LC_CTYPE sh -c "printf 'abc日本語def' | pbcopy"
LANG=ja_JP.UTF-8 pbpaste   #=> abc譌･譛ｬ隱枦ef

# 空になる: 非ASCIIのみ
env -u LANG -u LC_ALL -u LC_CTYPE sh -c "printf '日本語' | pbcopy"
LANG=ja_JP.UTF-8 pbpaste   #=> (空)

# LC_ALLを与えると正常
env -u LANG -u LC_CTYPE LC_ALL=en_US.UTF-8 sh -c "printf 'abc日本語def🎉' | pbcopy"
LANG=ja_JP.UTF-8 pbpaste   #=> abc日本語def🎉
```

自分の環境が該当するかは`echo "[$LANG][$LC_ALL][$LC_CTYPE]"`で分かる。すべて空なら踏む。

## Windowsとの違い

Windowsは`Set-Clipboard`/`Get-Clipboard`をPowerShell経由で呼び、
`[Console]::OpenStandardInput/Output`でUTF-8バイト列を明示的に読み書きしているためロケールに依存しない。
この問題はmacOS側だけの話。
