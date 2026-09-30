---
title: ブラウザタブ
description: 内蔵ブラウザタブの設定と、CLIからのURL遷移・内容の取得・スクリーンショット
---

`browser`は新規ブラウザタブ（`new-browser-tab`キーバインド、または`niwaterm tab new`のCLIで`--url`省略時）を開いた際のデフォルトURLを指定するオブジェクト。

| フィールド   | 型       | 意味                                                   |
| ------------ | -------- | ------------------------------------------------------ |
| `defaultUrl` | `string` | 新規ブラウザタブの初期表示URL。未指定時は`about:blank` |

```ts
browser: {
  defaultUrl: "https://example.com",
},
```

不正な値（空文字列等）を指定した場合、警告付きで`about:blank`にフォールバックする。CLIから`niwaterm tab new --tile <tileId> --url <url>`のように`--url`を指定した場合は、この設定に関わらず指定したURLが優先される。

キーバインド・コマンドパレットから開いた場合だけ、開いた直後のURL欄にフォーカスが入る（`defaultUrl`を設定していても全選択された状態なので、そのまま別のURLを打てる）。CLIの`tab new --url`ではフォーカスを奪わないため、エージェントからタブを生やしてもターミナルへの入力が逸れない。

## CLIから操作する

```sh
niwaterm browser navigate --tab <tabId> --url <url>
niwaterm browser get-text --tab <tabId>
niwaterm browser get-html --tab <tabId>
niwaterm browser screenshot --tab <tabId> --out <path>
niwaterm tab focus [--tab <tabId>]
```

ブラウザタブをCLIから操作するコマンド（PlaywrightのAPIのような感覚での操作を想定。読み取り中心のMVPで、click/fill等の操作系は未対応）。

- `browser navigate` — 指定したブラウザタブのURLを遷移する（Playwrightの`page.goto()`相当）。次のページ読み込み完了まで待って結果を返す
- `browser get-text` — 指定したブラウザタブの表示内容をプレーンテキストで取得する（`document.body.innerText`相当）
- `browser get-html` — 指定したブラウザタブのHTMLを取得する（`document.documentElement.outerHTML`相当）
- `browser screenshot` — 指定したブラウザタブの現在URLをheadlessブラウザ（Bun本体がv1.3.12以降ネイティブに提供する`Bun.WebView`、macOSはniwatermのElectrobun側と同じWKWebViewベース）で別途開き直し、スクリーンショットをPNGファイルに保存する。**表示中タブそのものではなく、別インスタンスで同じURLを新規に開いた場合の見た目**になる点に注意（ログイン状態やスクロール位置、フォーム入力中の値などは反映されない）

対象`tabId`がterminalタブの場合、または存在しない場合は、いずれもエラーメッセージと共に終了コード1を返す。対象タブの所属ワークスペースが非アクティブ（他のワークスペースを表示中）な場合もエラーになる。その場合は先に`tab focus`で対象ワークスペースをアクティブ化してから呼び直す。

- `tab focus` — 指定したタブが属するワークスペース・タイルへ切り替え、そのタブをアクティブ化し、ウィンドウを前面化する。**AIが普段ヘッドレスでブラウザタブを操作しつつ、人間が確認したい時に任意でその画面を見られるようにするためのコマンド**。`tab switch`/`tile focus`と役割が重なって見えるが、粒度が異なる合成コマンドである:
  - `tab switch --tile --tab`（または`--direction`） — 同一タイル内でのアクティブタブ切替のみ（ワークスペース非依存、ウィンドウ前面化なし）
  - `tile focus --tile` — フォーカス（キー入力の宛先）を移すのみ
  - `tab focus --tab` — `tabId`だけを渡せば、内部でワークスペース切替・タイルフォーカス・タブアクティブ化・ウィンドウ前面化までを代行する

「表示中タブそのものの見た目を確認したい」場合は、`tab focus`で実ウィンドウを前面化して直接目視するか、`browser screenshot`で同じURLのheadlessスクショを撮る。後者はDOM状態が再現されない代わりに、人間が画面の前にいなくても確認できる。使い分けの目安として、両者は互いを置き換えるものではない。
