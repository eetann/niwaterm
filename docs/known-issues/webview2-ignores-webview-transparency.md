---
type: Known Issue
title: "WindowsのWebView2では<electrobun-webview>の背景透過が効かない"
description: toggleTransparent(true)を呼んでもwebviewの地は透けず、ページが背景を指定しなければ白いまま。背後のUIへ馴染ませるにはHTML側で地を塗るしかない
---

# WindowsのWebView2では`<electrobun-webview>`の背景透過が効かない

## 症状

`<electrobun-webview>`で読み込んだページが`body { background: transparent }`を指定していても、
**webviewの矩形は白いまま**で、背後に敷いたHTMLのUIは透けない。

niwatermでは、`customView`のサイドバーパネルがサイドバーの地（半透明＋背景画像）を覆い隠し、
そこだけ白く浮く形で出た。

## 原因

`webviewEl.toggleTransparent(true)`（devkitの`api/preload/webviewTag.ts`）はネイティブへ
`webviewTagSetTransparent`を送るが、**Windowsでは何も起きない**。エラーも警告も出ないため、
呼んだ側からは成功したように見える。

preload側は同時に`this.style.opacity = "0"`も行うが、これが効くのは`<electrobun-webview>`という
軽量DOM要素だけで、実体のネイティブオーバーレイ（OOPIF）には関係しない
（[OOPIFはCSSの管轄外](./electrobun-hidden-webview-still-eats-mouse-events.md)）。

なおページ側で`body`を透明にしても、ビューポートの地はWebView2の既定色（白）が残る。
`html`まで透明にしても同じ。

macOS（WKWebView）での挙動は未確認。

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

ウィンドウ自体の透過（`appearance.backgroundOpacity`で背後のデスクトップが透ける分）までは
再現できない。webviewの矩形だけは不透明になる。

行のホバー・枠線のような中間色は、地の色と混ぜず**文字色からの透明度だけ**で作ると、
背景のグラデーションを潰さずに済む（`color-mix(in srgb, var(--fg) 10%, transparent)`）。
