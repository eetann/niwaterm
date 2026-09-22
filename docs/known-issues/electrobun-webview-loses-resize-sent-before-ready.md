---
type: Known Issue
title: "<electrobun-webview>がネイティブ側の準備前に送った位置を失い、二度と送り直さない"
description: OverlaySyncControllerは送信済みの矩形を最新として覚えるため、ネイティブ側がまだ受け取れない段階で送った位置更新は捨てられたまま再送されず、webviewが古い矩形に居座る
---

# `<electrobun-webview>`がネイティブ側の準備前に送った位置を失い、二度と送り直さない

## 症状

`<electrobun-webview>`が、DOM上の要素より**ずれた位置**に表示され続ける。要素自身のCSSは正しく、
DevTools上の矩形も正しいのに、ネイティブ側のオーバーレイだけが別の場所にいる。

niwatermでは、`customView`のサイドバーパネルがワークスペース一覧との切替スイッチャーを覆い隠し、
一覧へ戻れなくなる形で出た（スイッチャーの高さぶん上にずれていた）。

Windowsではアプリのログに次が出る。

```
[WebView2] ERROR: Controller is NULL, cannot resize
```

## 原因

`<electrobun-webview>`の位置追従は`OverlaySyncController`（devkitの`api/preload/overlaySync.ts`）が担っていて、
100msごとのポーリングと`ResizeObserver`で矩形を見ている。**前回送った矩形と同じなら送らない**作りなので、
送信そのものが失敗した場合に再送する経路が無い。

一方ネイティブ側のwebviewはDOMより遅れて生成される。生成前に届いた位置更新は捨てられるため、
「webview要素は生成直後の矩形で同期 → 直後にレイアウトが動いて新しい矩形を送る → まだネイティブが
用意できておらず破棄される → 送った側は新しい矩形を最新として記録済みなので二度と送らない」という順序を踏むと、
**生成直後の矩形のまま固定される**。

レイアウトが動く例は、React等で後から描画される兄弟要素が現れて、webviewを含む領域が押し下げられるケース。
`root.render()`は同期的に反映されないため、`appendChild`の直後に矩形が変わりやすい。

## 対処

ネイティブ側の生成完了を示す`dom-ready`で、現在の矩形を強制的に送り直す。

```ts
webviewEl.on("dom-ready", () => {
  webviewEl.syncDimensions(true);
});
```

`syncDimensions(true)`は`OverlaySyncController.forceSync()`を呼び、前回送った矩形と同じでも送信する。

## 切り分け方

ずれ幅が「後から現れた要素の高さ」と一致するかを見る。一致するなら、その要素が描画される前の矩形で
固定されている。ウィンドウをリサイズすると矩形が変わって送り直されるため、**リサイズすると直る**のも特徴。

## 関連

- [`toggleHidden`したwebviewが背後のUIのマウスイベントを奪い続ける](./electrobun-hidden-webview-still-eats-mouse-events.md) —
  同じく「OOPIFはWebKitのレンダリングツリーの外側にいる」ことから来る問題
