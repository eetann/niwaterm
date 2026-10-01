---
title: ブラウザタブ
description: タイルの中でWebページを開くブラウザタブの使い方と、CLIからのページ移動・内容の取得・スクリーンショット
---

ブラウザタブを使うと、タイルの中でWebページを開ける。ターミナルの隣に開発中のページやドキュメントを並べて見られる。

## ブラウザタブを開く

prefix + `shift+t`でブラウザタブが開く。開いた直後はURL欄が選ばれた状態になっているので、そのままURLを打って`Enter`を押す。`https://`は省略できる。

タブの上のツールバーには、戻る・進む・再読み込みのボタンとURL欄が並ぶ。あとからURLを打ち替えたいときは、prefix + `u`でURL欄へ移る。URL欄で`Escape`を押すと、打ちかけのURLを元に戻してターミナルへ戻る。

新しいブラウザタブで最初に開くページは、設定ファイルの`browser.defaultUrl`で決める。デフォルトは空白のページ（`about:blank`）。

```ts
browser: {
  defaultUrl: "https://example.com",
},
```

ターミナルに出たURLを、クリックでブラウザタブに開くこともできる（[マウスとリンク](/niwaterm/mouse-and-links/#urlをクリックで開く)の`link.open`）。

## CLIから操作する

`niwa`コマンドから、ブラウザタブのページを移動したり、表示している内容を取り出したりできる。AIエージェントにページの内容を読ませたいときに使う。

```sh
niwa browser navigate --tab <tabId> --url <url>
niwa browser get-text --tab <tabId>
niwa browser get-html --tab <tabId>
niwa browser screenshot --tab <tabId> --out <path>
niwa tab focus [--tab <tabId>]
```

- `browser navigate` — ブラウザタブで指定したURLを開く。ページを読み込み終わるまで待つ
- `browser get-text` — ブラウザタブに表示している内容を、テキストで出力する
- `browser get-html` — ブラウザタブのページのHTMLを出力する
- `browser screenshot` — ブラウザタブと同じURLを画面に出さずに開き直し、スクリーンショットをPNGで保存する。開き直すので、ログインした状態・スクロールの位置・フォームに入力中の文字は写らない。Windowsでは使えない
- `tab focus` — 指定したタブへ切り替えて、niwatermのウィンドウを前面に出す。エージェントが操作していたページを、人が目で確かめたいときに使う

`<tabId>`は`niwa list`で調べられる。`browser`のコマンドは、ブラウザタブにしか使えない。ほかのワークスペースにあるブラウザタブを操作するときは、先に`tab focus`でそのタブへ切り替える。
