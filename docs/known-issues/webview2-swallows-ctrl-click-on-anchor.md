---
type: Known Issue
title: "WebView2が<a>上のctrl+クリックのclickイベントをDOMへ配らない"
description: Windows(WebView2)ではリンク要素の上でctrlを押しながらクリックすると、mousedown/mouseupは届くのにclickイベントだけが発火しない。ブラウザの「新しいタブで開く」操作としてネイティブ側が握り潰すため、clickに載せた処理は修飾キー付きのリンククリックで動かない
---

# WebView2が`<a>`上のctrl+クリックのclickイベントをDOMへ配らない

## 症状

Windows（WebView2）で、`<a href>`の上を**ctrlを押しながら左クリック**すると`click`イベントが
発火しない。同じ位置の素のテキスト（`<a>`でない要素）をctrl+クリックした場合は発火するため、
「素のURLは開けるのにOSC 8ハイパーリンクだけ開けない」という形で出る。

`mousedown`・`mouseup`は通常どおり発火し、`ctrlKey`も`target`（`<a>`要素）も正しい。
落ちるのは`click`だけ。

## 原因

ctrl+クリックはブラウザにとって「リンクを新しいタブで開く」操作で、WebView2はこれをネイティブ側で
処理してDOMへは配らない。`click`が来ない以上`preventDefault()`する機会も無く、JS側からは
抑止できない。

## 対処

リンクを開く判断を`click`ではなく`mousedown`＋`mouseup`で行う。押した時点のリンクを覚えておき、
同じリンクの上でボタンが離されたら開く（`src/mainview/index.ts`の`pressedLink`）。

```ts
document.addEventListener("mousedown", (e) => {
  pressedLink = e.button === 0 && linkModifierHeld(e) ? linkAtEvent(e) : null;
  if (pressedLink) e.preventDefault();
});

document.addEventListener("mouseup", (e) => {
  const link = pressedLink;
  pressedLink = null;
  if (!link || linkAtEvent(e)?.url !== link.url) return;
  // ここで開く
});
```

あわせて、`click`が**届く**経路（修飾キー無しのクリック、`link.modifier`をaltにした場合等）では
`<a>`の既定のナビゲーションが走り、**mainviewのwebviewごとそのURLへ遷移してしまう**。
ターミナル出力内の`<a>`のclickは、修飾キーの有無に関わらず常に`preventDefault()`しておく。

## 切り分け方

`mousedown` / `mouseup` / `click`のそれぞれにリスナーを付け、どこまで届いているかを記録する。
Windows実機ではwebviewのconsoleを直接読めないため、設定ファイルの`niwa.on("open-link", ...)`から
ファイルへ追記する形にすると確認しやすい（RPCが到達しているかも同時に分かる）。

```ts
// niwaterm.config.ts（検証用）
keybindings: (niwa) => {
  niwa.on("open-link", async (event) => {
    await appendFile(LOG, `${new Date().toISOString()} ${event.url}\n`);
  });
},
```

同じイベントを短時間に複数受け取るため、`Bun.file().text()`で読んでから`Bun.write`で書き戻す
方式だと取りこぼす。`appendFile`を使うこと。

## 関連

- macOS（WKWebView）ではこの握り潰しは起きない。OSC 8ハイパーリンクのクリックを最初に実装した
  時点ではmacOSでしか確認しておらず、修飾キーを要求するようになって初めてWindowsで顕在化した
