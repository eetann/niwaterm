---
type: Known Issue
title: "Windows実機: 起動直後にキー入力が届かない・クリック後も日本語入力だけできない"
description: Windowsでniwatermを起動した直後はwebviewがOSキーボードフォーカスを持たず、クリックで復帰させてもChromiumのmousedown既定動作がimeElのフォーカスを剥がすため日本語入力だけが死ぬ。原因の異なる2段構えの不具合として調査結果と対処を記録する
---

# Windows実機: 起動直後にキー入力が届かない・クリック後も日本語入力だけできない

## 症状

Windows実機（niwaterm-wip / niwaterm-daily 共通）で、起動直後に次の2段階の症状が出る。

1. ウィンドウは前面に出ているのにキー入力が一切届かない。日本語入力に切り替えると、
   niwaterm内ではなく**画面左上にWindowsのIMEウィンドウが浮く**（入力欄が無いときの挙動）
2. ターミナル領域をマウスでクリックするとASCIIは打てるようになるが、**日本語入力だけができない**。
   変換候補ウィンドウも未確定の下線も出ず、ローマ字がそのままPTYへ送られる

2の状態はポップアップ（`niwaterm popup lazygit`等）を開くと直る。クリックを繰り返しても直らない。

## 原因1: 生成時のactivateではWebView2へフォーカスが渡らない

`BrowserWindow`は生成時に`activate: true`が既定で渡るが、その時点ではWebView2のコントローラがまだ
存在しないため、ネイティブ側の`FocusActiveView()`（`controller->MoveFocus(PROGRAMMATIC)` +
`browser->GetHost()->SetFocus(true)`）が対象を見つけられず、web contentへフォーカスが渡らない。
生成直後に`mainWindow.activate()`を呼んでも同じで、こちらはHWNDを前面化するだけなうえ、
[activateWindow()でpopup表示直後にキー入力が届かなくなる](/known-issues/windows-popup-activatewindow-focus-loss.md)のとおり
既にwebviewが持っていたフォーカスをむしろ壊す。

webview側の診断ログでは、`document.activeElement`は`#ime-input`のままなのに
`document.hasFocus()`が`false`になっていた。**ドキュメントが非フォーカスだとChromiumはOSのIMEを
無効化する**ため、日本語入力がniwatermの外（画面左上のIMEウィンドウ）へ流れる。

**対処**: webviewの準備ができた`ready`受信時に一度だけ`mainWindow.show()`を呼ぶ。
`show()`は`showWindow(activate: true)`へ落ち、ネイティブ側で`activateVisibleWindow()` →
`FocusActiveView()`まで実行されるため、web contentへフォーカスが渡る。`activate()`はWindowsでは呼ばない。

## 原因2: mousedownの既定動作がimeElのフォーカスを剥がす

キー入力の受け口である不可視textarea（`#ime-input`）へは、タイルの`mousedown`リスナーで
`focus()`していた。ところがChromiumは**mousedownの既定動作**として「クリック先の最も近い
フォーカス可能な祖先」へフォーカスを移し、見つからなければフォーカスを外す。この既定動作は
リスナーの実行**後**に走るため、`.term`（フォーカス不能）をクリックすると
`document.activeElement`は`body`になり、リスナー内の`focus()`は上書きされる。

キーバインドとPTYへの入力は`document`レベルの`keydown`で拾っているのでASCIIは打てる。一方で
**編集可能要素にフォーカスが無いとChromiumはOSのIMEを無効にする**ため、日本語入力だけが死ぬ。
ポップアップを開くと直るのは、ポップアップ表示時の`imeEl.focus()`がmousedownの外（RPC経由の
非同期処理）で走り、既定動作に上書きされないため。

実機の診断ログでこの遷移がそのまま観測できた。

```
tile mousedown: after imeEl.focus()   active=TEXTAREA#ime-input
event: imeEl blur                     active=BODY   ← 既定動作がフォーカスを剥がす
tile mouseup: before refocus          active=BODY
tile mouseup: after refocus           active=TEXTAREA#ime-input
event: keydown keyCode=229 → compositionstart
```

**対処**: 既定動作が終わった`mouseup`で`imeEl`へフォーカスを入れ直す。ドラッグでテキスト選択した
直後（選択が残っている）は、フォーカス移動が選択を壊すためスキップする。

## 切り分けの進め方

Windows実機ではbunプロセスの標準出力が`mise run win:start`のログファイルへ届かないため、
webview側の`sendMessage("log", ...)`だけでは何も見えない。`log`ハンドラから
`appSupportDir()`配下のファイルへ`appendFileSync`する一時コードを足すと、WSLから
`/mnt/c/Users/<user>/AppData/Roaming/<APP_VARIANT>/` を読むだけで追える。

フォーカス系の調査では`document.activeElement`だけでなく**`document.hasFocus()`を必ず併記する**。
DOM上のフォーカスとOSキーボードフォーカスは別物で、前者だけ見ていると原因1を見落とす。

また、`electrobun dev`のビルドロックを掴んだ`hutch.exe` / `hutch-engine.exe`が孤児プロセスとして
残っていると、`mise run start`が古いバイナリのまま起動して**修正が反映されていない状態でテストして
しまう**。実機テストの前に、ビルド成果物（`build/<app>/dev-win-x64/.../Resources/app/`）へ変更が
入っているかを文字列grepで確認すること。

## 関連

- [activateWindow()でpopup表示直後にキー入力が届かなくなる](/known-issues/windows-popup-activatewindow-focus-loss.md) — 原因1と同根。`activate()`の代わりに`show()`を使う手が有効な可能性がある
- [Windowsでのビルド・実行手順](/build/windows-build.md) — 実機セットアップ・ログの見方
- `src/bun/index.ts` — `focusWebviewOnce()`、`ready`ハンドラ
- `src/mainview/index.ts` — `tileTreeEl`の`mousedown` / `mouseup`リスナー
