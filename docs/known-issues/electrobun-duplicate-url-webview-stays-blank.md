---
type: Known Issue
title: 同じURLの<electrobun-webview>を2つ作ると後から作った方が真っ白のままになる
description: Electrobun 2.0.1では、既に表示中のwebviewと同じURLで別のwebviewを作ると、後から作った方のネイティブ側の初期化が完了せず何も描画されない。customViewを複数登録するときはビューごとに別のHTMLを指す必要がある
---

# 同じURLの`<electrobun-webview>`を2つ作ると後から作った方が真っ白のままになる

## 症状

同じURL（`file:///.../notes.html`等）を`src`に持つ`<electrobun-webview>`を2つ作ると、
**後から作った方だけ中身が描画されない**。要素自体はDOMに繋がっていて矩形も正常、
`webviewTagInit`も応答を返して`webviewId`まで割り当てられるのに、
そのwebviewのナビゲーションが始まらず、サイドバーの地だけが見える状態で止まる。

niwatermでは、`customViews`へ同じHTMLを2つ登録した（同じUIを別名で並べた）ときに、
2つ目のビューを開くとパネルが空のまま、という形で出た。

## 切り分け方

URLだけを別のファイルに変えて同じ手順を踏めば正常に描画される。
片方のパネルを開かないまま（webviewを作らないまま）にしても、もう片方は正常に出る。

**Windows実機のログはあてにしない**。`powershell.exe`経由でリダイレクトしたログは数分単位で
バッファされるため、`[WebView2] NavigationStarting fired for webview N`が出ていないことを
「webviewが作られていない」根拠にすると誤診する（実際には作られていて表示も終わっている）。
判定はスクリーンショットで行う。

## 対処

**ビューごとに別のHTMLファイルを指す**。同じUIを複数のビューで使い回したい場合は、
中身を共有した薄いHTMLをビューの数だけ用意する（`<script src>`・`<link>`で本体を読めば実体は1つで済む）。

niwaterm側では回避していない。URLへビューidのクエリを足して一意にする手はあるが、
`file://`のクエリはHTML側の`location.search`にも現れるため、ユーザーのHTMLへ影響が漏れる。
