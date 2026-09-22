---
type: Known Issue
title: "<electrobun-webview>の地は透かせない（toggleTransparentは非表示のAPI）"
description: toggleTransparentは名前に反して背景ではなくwebview自体を消すAPIで、背景透過はウィンドウ単位にしか指定できない。仮に透けてもOOPIFは兄弟HWNDなので背後のHTMLは見えない
---

# `<electrobun-webview>`の地は透かせない（`toggleTransparent`は非表示のAPI）

## 症状

`<electrobun-webview>`で読み込んだページが`body { background: transparent }`を指定していても、
**webviewの矩形は白いまま**で、背後に敷いたHTMLのUIは透けない。

niwatermでは、`customView`のサイドバーパネルがサイドバーの地（半透明＋背景画像）を覆い隠し、
そこだけ白く浮く形で出た。

## 原因

### `toggleTransparent`は背景のAPIではない

`webviewEl.toggleTransparent(true)`（devkitの`api/preload/webviewTag.ts`）は、名前に反して
**webview自体を消す**。背景色には一切触れない。

| プラットフォーム | `setTransparent`の実装 |
|---|---|
| Windows（WebView2） | `controller->put_IsVisible(transparent ? FALSE : TRUE)` |
| Windows（CEF） | `ShowWindow(browserHwnd, SW_HIDE)` |
| macOS | `self.nsView.layer.opacity = transparent ? 0 : 1` |

Electrobun自身のコメントがこの意図を明言している（macOSの`setAlphaBlending`の説明）。

> unlike setTransparent (which hides the layer for the webview-tag show/hide dance),
> this keeps the layer visible and lets the surface's alpha channel composite against
> whatever is behind the view

preload側が併せて行う`this.style.opacity = "0"`も、効くのは`<electrobun-webview>`という軽量DOM要素までで、
実体のネイティブオーバーレイ（OOPIF）には関係しない。

**呼んでも成功・失敗が分からない**点にも注意する。この呼び出しはfire-and-forgetのメッセージで、
ネイティブ側もwebviewのポインタやシンボルが引けなければ黙ってreturnする。

### 背景透過はウィンドウ単位にしか指定できない

本物の背景透過（`put_DefaultBackgroundColor`・`drawsBackground`・`webkit_web_view_set_background_color`）は
**webviewの生成時にしか適用されず**、その真偽値は**親ウィンドウの`transparent`フラグ**から来る。
webview単位で後から指定する口は無い。

macOSはさらに、OOPIFを明示的に対象外にしている。

```objc
// Only set transparent background for main window webviews (autoResize/fullscreen)
// Child webviews (OOPIFs) need a visible background to render properly
if (autoResize) { ... }
```

`autoResize`が真になるのはメインウィンドウのwebviewだけで、`<electrobun-webview>`は常に偽。

### 透けたとしても背後のHTMLは見えない

メインのwebviewもOOPIFも**同じコンテナHWNDを親に持つ兄弟**として作られる。兄弟のHWND同士は
アルファ合成されないため、OOPIFの矩形の背後にあるのは「メインのwebviewが描いたUI」ではなく
ウィンドウ自身のバッキングサーフェスになる。

つまり仮にOOPIFの地を透明にできても、そこに見えるのは**サイドバーではなくデスクトップ**で、
サイドバーから切り抜かれた穴になるだけ。背後のHTMLと合成される経路がそもそも無い。

これは[OOPIFがCSSの管轄外である](./electrobun-hidden-webview-still-eats-mouse-events.md)のと同じ話が、
マウスイベントではなく描画側に現れたもの。

## 対処

**HTML側で地を塗る**。背後のUIへ馴染ませたい場合は、背後と同じ塗り方を再現する。

niwatermは`customView`のHTMLへ`window.niwaterm.theme`で背景色・背景画像・文字色を渡しているので、
これをCSS変数へ流し込めばターミナルと同じ地になる（`contrib/custom-views/worktrees/worktrees.html`）。

```css
body {
  background-color: var(--bg);
  background-image: var(--bg-image);
  background-size: cover;
  background-position: center;
}
```

ウィンドウ自体の透過（`appearance.backgroundOpacity`で背後のデスクトップが透ける分）は再現できない。
アルファの中間値もそもそも扱えない（`put_DefaultBackgroundColor`が受け付けるのはアルファ0か255だけで、
webview版の`setAlphaBlending`は存在しない）。

行のホバー・枠線のような中間色は、地の色と混ぜず**文字色からの透明度だけ**で作ると、
背景のグラデーションを潰さずに済む（`color-mix(in srgb, var(--fg) 10%, transparent)`）。

## 関連

- `toggleTransparent`は**呼んではいけない**。将来のElectrobunで`put_IsVisible(FALSE)`が効くようになると、
  customViewのパネルが表示されなくなる
- ウィンドウ全体の透過がどう成立しているかは
  [透過ウィンドウでタイトルバーが描画されない](./windows-electrobun-transparent-window-hides-titlebar.md)を参照
