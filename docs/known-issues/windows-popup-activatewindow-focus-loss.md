---
type: Known Issue
title: "Windows実機: activateWindow()でpopup表示直後にキー入力が届かなくなる"
description: mainWindow.activate()を呼ぶと、Windows実機でwebviewのOSキーボードフォーカスが失われ、JS側からfocus()を何度呼んでも回復せず実際のマウスクリックでしか復帰できなくなる。popupのopenPopupエンドポイントでこれを踏んだため、原因の切り分けと対処方法を記録する
---

# Windows実機: activateWindow()でpopup表示直後にキー入力が届かなくなる

## 症状

Windows実機で`niwaterm popup`（CLI）や`POST /popup`（IPC）経由でpopupを開くと、開いた直後はキー入力が一切届かない。ポップアップ内のterm表示領域を一度マウスでクリックすると、以後は正常にキー入力できるようになる。`niwaterm popup lazygit`のように`command`を指定したワンショット実行でも同様に発生する。

## 根本原因

`ipc-server.ts`の`/popup`エンドポイントは、popup作成成功後に`activateWindow()`（`mainWindow.activate()`、Electrobunの`ffi.request.activateWindow`経由でWindowsのウィンドウアクティブ化APIを呼ぶ）を呼んでいた。この呼び出し自体が、Windows実機で**webviewのOSキーボードフォーカスを破壊する**。

具体的には、`activateWindow()`を呼んだ後、webview側で`imeEl.focus()`（キー入力の受け口であるtextareaへのフォーカス）を呼んでも、`document.activeElement`はJS内部的には`imeEl`に更新されるが、実際の`focus`/`focusin`イベントは発火せず、`document`レベルの`keydown`イベントすら一切発火しなくなる。`requestAnimationFrame`や`setTimeout`で最大1.5秒待って`focus()`をリトライしても回復しない。回復する唯一の方法は、実際の物理的なマウスクリックだった。

## 切り分けの経緯

Windows実機で、webview側に一時的な診断ログ（`sendMessage("log", ...)`でbunコンソールへ転送）を仕込み、以下を順に検証した。

| 検証 | 結果 |
| --- | --- |
| `document.activeElement`と`document.hasFocus()`をpopup表示前後で確認 | `activeElement`は`ime-input`になるが`hasFocus()`は常に`false`（起動直後・通常操作時も含め常にfalseだったため、この指標自体は無意味と判明） |
| `imeEl`に`focus`/`blur`イベントリスナー、`document`に`focusin`/`focusout`リスナーを追加 | popup表示時、`focus()`を呼んでも`focus`/`focusin`イベントが一切発火しない（＝プログラム的なactiveElement更新はされるが実効的なフォーカス移動が起きていない） |
| `document`の`keydown`ハンドラに`currentTabId`等をログ出力 | popup表示後にSendKeysで送ったキーで`keydown`自体が発火しない。クリック後は正しく発火する |
| CLIから`tab new`（`activateWindow()`を呼ばない操作）を同条件で実行 | 正常にkeydownが発火し入力が届く。popup固有の問題と確定 |
| popup-toolbarのReact描画を無効化 | 症状変化なし。ボタン要素がフォーカスを奪っているわけではないと判明 |
| `#ime-input`に`z-index`を追加（`#popup`のz-index:10配下に隠れている可能性を検証） | 症状変化なし |
| `imeEl`をDOM階層としてpopup要素の内側へ一時移動 | 症状変化なし |
| `#popup`の`position: fixed`を`absolute`に変更 | Bunプロセスがセグメンテーションフォルトでクラッシュ（`EmbeddedBrowserWebView.dll`内）。関連の疑いはあるが未解明のまま`fixed`に戻した |
| `hidden`属性のトグルを`visibility`+`pointer-events`方式に変更 | 症状変化なし |
| サイドバーを閉じた状態で再検証（`renderSidebar`の再描画が原因でないか） | 症状変化なし |
| **`/popup`エンドポイントの`activateWindow()`をコメントアウトして再検証** | **クリックなしでpopup表示直後から正常にkeydownが発火した** |

これで`activateWindow()`の呼び出しそのものが原因と確定した。ネイティブ層（Electrobunの`BrowserWindow.activate()` → `ffi.request.activateWindow`）がWindows側で何らかのウィンドウアクティブ化APIを呼ぶ際に、webview（WebView2）コントロールへのOSキーボードフォーカス委譲を壊し、それ以降JS側からの`.focus()`では回復できない状態になる、というのが最も筋の通る説明。ただしElectrobun/WebView2側の内部実装までは追えていない。

## 対処方法

`src/bun/ipc-server.ts`の`POST /popup`から`activateWindow()`の呼び出しを削除した。popupは「今操作しているniwatermに対して素早く一時的な操作をする」用途が主で、既にウィンドウがフォアグラウンドの状態で開かれるケースがほとんどのため、ウィンドウ前面化を諦めても実用上の支障は小さいと判断した。バックグラウンドから`niwaterm popup`を実行した場合はウィンドウが自動的に前面化されなくなるが、その場合は手動でアプリをクリックすれば通常通り操作できる。

`tab show`等、他の`activateWindow()`呼び出し箇所（目視確認が主目的で、その後すぐにキー入力を行うことを前提としていない操作）は今回のスコープ外として維持した。今後同種の症状が別のエンドポイントで報告された場合は、同様に`activateWindow()`の要否を見直すこと。

## 関連

- [Windowsでのビルド・実行手順](/build/windows-build.md) — 実機セットアップ手順
- [CLIリファレンス](/guide/cli.md) — `niwaterm popup`
- `src/bun/ipc-server.ts` — `/popup`エンドポイント、`activateWindow`引数
- `src/bun/index.ts` — `mainWindow.activate()`、`createIpcServer`への`activateWindow`引数の受け渡し
- `src/mainview/index.ts` — `applyPopupState`（popup表示時に`imeEl.focus()`する処理）
