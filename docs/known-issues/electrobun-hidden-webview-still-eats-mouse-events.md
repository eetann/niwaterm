---
type: Known Issue
title: "toggleHiddenした<electrobun-webview>が背後のUIのマウスイベントを奪い続ける"
description: Electrobun 2.0.1のwebviewタグはtoggleHidden(true)で見た目上は消えるが、ネイティブオーバーレイ(OOPIF)がマウスイベントを受け取り続け、真下に重なっているHTML側のUIがクリック・ホバーに反応しなくなる。togglePassthrough(true)の併用が必要
---

# toggleHiddenした`<electrobun-webview>`が背後のUIのマウスイベントを奪い続ける

## 症状

`<electrobun-webview>`を`toggleHidden(true)`で隠すと、描画上は完全に消えて背後のHTMLが見える。
しかしその矩形の中では**マウスイベントだけが背後のHTMLへ届かなくなる**。クリックが無反応になるだけでなく、
`:hover`も効かずカーソル形状も既定の矢印のままになるため、「見えているのにクリックできないUI」になる。

niwatermでは、`customView`（サイドバーのNotesタブ等）を設定しているユーザーだけ
サイドバーのBoard/Workspace一覧がクリックできない、という形で発現した。`#sidebar-custom-view`は
OOPIFのサイズ同期のため常に`position:absolute; inset:0`でレイアウトを持たせる設計なので、
`#sidebar-list`と完全に重なっているため。

## 原因

`toggleHidden()`が触るのはネイティブ側オーバーレイの表示状態だけで、ヒットテストの対象からは外れない。
またこのオーバーレイはWebKitのレンダリングツリーの外側にいるため、`#sidebar-custom-view`側に
`pointer-events: none`を指定しても効かない（CSSが効くのは`<electrobun-webview>`という軽量DOM要素まで）。

マウスイベントを素通りさせる専用APIが別にあり、そちらは`webviewSetPassthrough`としてネイティブへ伝わる。

## 対処

隠すときは`toggleHidden`と`togglePassthrough`を必ずセットで呼ぶ。

```ts
function setCustomViewWebviewActive(active: boolean): void {
  customViewWebviewEl?.toggleHidden(!active);
  customViewWebviewEl?.togglePassthrough(!active);
}
```

`toggleHidden()`/`togglePassthrough()`はどちらも`webviewId`が確定する前に呼んでも無視されるため、
生成直後の初期状態の適用は`dom-ready`を待ってから行う（`src/mainview/index.ts`の`applyCustomView`）。

## 切り分け方

「クリックできない」がHTML側の問題（overlay要素・イベントハンドラ）なのかネイティブオーバーレイなのかは、
**カーソル形状とhoverが変わるか**で判別できる。

- ホバーしても`cursor: pointer`にならず`:hover`のスタイルも当たらない → マウスイベントがWebKitに届いていない
  （＝ネイティブオーバーレイ側の問題）
- カーソルは変わるのにクリックだけ効かない → HTML/JS側の問題

macOSでの確認は`cliclick m:<x>,<y>`でカーソルを移動し、`screencapture -x -C`（`-C`でカーソルも撮る）で
撮ったスクリーンショットを見るのが早い。

## 関連

- 同じ「OOPIFはCSSの管轄外」問題として、`toggleHidden`中も`<electrobun-webview>`要素自身の
  白背景は残る（`src/mainview/index.css`で`background: transparent`を明示している）
- ブラウザタブ（`setTabVisible`）でも同じ症状が出る。親の`.tab-content`ごと`display:none`に
  しても、非表示になったブラウザタブがいたタイル上ではターミナルのカーソルが`text`にならず
  クリックも効かなくなる（実機で確認済み）ため、こちらも`togglePassthrough`を併用している
