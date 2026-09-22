---
type: Known Issue
title: "Windowsで透過ウィンドウにするとネイティブのタイトルバーが描画されなくなる"
description: Electrobun 2.0.1の`transparent: true`はWindowsでWS_EX_LAYEREDを立てるだけでレイヤーを塗らないため、WebView2構成ではタイトルバー・ウィンドウボタンが見えなくなる。WS_EX_LAYEREDを外してDWMの透過へ切り替えると、枠を保ったまま透過できる
---

# Windowsで透過ウィンドウにするとネイティブのタイトルバーが描画されなくなる

## 症状

`new BrowserWindow({ transparent: true })`で起動すると、背景の透過自体は効くが、
**タイトル文字・最小化/最大化/閉じるボタンが一切描画されない**。ウィンドウがあるべき場所の
上端には背後のウィンドウがそのまま見える。

ウィンドウスタイルを実測すると`WS_CAPTION`・`WS_THICKFRAME`は残っており、ドラッグ移動・
リサイズは機能する。見えないだけで枠は生きている。

```
通常:  style=0x14CF0000 CAPTION=True THICKFRAME=True  exstyle=0x00040100 LAYERED=False
透過:  style=0x14CF0000 CAPTION=True THICKFRAME=True  exstyle=0x000C0100 LAYERED=True
```

macOSでは起きない。`window.opaque = NO`とclearColorを設定するだけでstyleMaskを触らないため、
タイトルバーはそのまま残る。

## 原因

Electrobunの`transparent`はWindowsで`WS_EX_LAYERED`を追加するのみで、
`SetLayeredWindowAttributes`も`UpdateLayeredWindow`も呼ばない
（`package/src/native/win/nativeWrapper.cpp`）。これはCEFのオフスクリーン描画が
レイヤーを毎フレーム塗る前提のコードで、ネイティブレンダラ（WebView2）構成では誰も塗らない。

WebView2は子HWNDとして別に合成されるので中身は表示されるが、親ウィンドウの描画にあたる
DWMのキャプション・枠の出力が行われなくなる。

## 対処

`WS_EX_LAYERED`を使わず、DWM側の透過機構へオプトインする。Windowsでは
`DwmExtendFrameIntoClientArea` / `DwmEnableBlurBehindWindow` / `WS_EX_NOREDIRECTIONBITMAP`の
いずれかを呼ばない限り、ウィンドウのアルファはDWMに無視される。

niwatermでは`src/native/winwindow.c`（`niwa_win_enable_window_transparency`）が
ウィンドウ生成後に次を行う。

1. `WS_EX_LAYERED`を外す
2. 空リージョンを渡した`DwmEnableBlurBehindWindow`でper-pixel alphaを有効化
3. ウィンドウプロシージャを差し替え、`WM_ERASEBKGND`で`PatBlt(..., BLACKNESS)`
4. クライアント領域の高さを`cyTopHeight`にした`DwmExtendFrameIntoClientArea`

**3が無いと透過しない。** Electrobunのウィンドウクラスは`hbrBackground = NULL`で
クライアント領域を一切塗らないため、リダイレクションサーフェスのアルファが既定の不透明
（白）のまま残る。`BLACKNESS`のPatBltはRGBA全チャンネルを0にするので、これがアルファの
クリアになる。

3が無い状態は「画面のどこを測っても同じ色」になるのが目印で、背後と合成されていない。
入れると位置ごとに値が変わる。

4のマージンに全辺`-1`（sheet of glass）を渡すとウィンドウ全体がガラス扱いになり、
今度は**キャプションの地まで背後と合成されて透けてしまう**（タイトル文字とウィンドウボタンは
残るので、宙に浮いたように見える）。マージンはクライアント領域の内側で数えるため、
上辺から`cyTopHeight`ぶんだけ拡張すればクライアント領域だけをガラスにできる。
この高さはリサイズで変わるので`WM_SIZE`のたびに測り直して張り直す。

`transparent: true`自体は渡し続ける必要がある。WebView2の`put_DefaultBackgroundColor`を
透明にする経路がこのフラグに紐づいているため。なお同APIはアルファ0か255しか受け付けないので、
半透明はwebview側のCSSで作る。

## 副作用

透過中はサブピクセルアンチエイリアス（ClearType）が使えずグレースケール描画になる。
これはDWM経路・`WS_EX_LAYERED`経路のどちらでも同じで、半透明背景そのものの帰結。
`appearance.backgroundOpacity`を既定の`1`のままにしていれば発生しない。

## 関連

- 設定の使い方: docs/guide/config.md「背景の透過・グラデーション・画像」
