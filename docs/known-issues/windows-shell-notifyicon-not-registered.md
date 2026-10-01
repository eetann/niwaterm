---
type: Known Issue
title: "Windows実機: Electrobunのデスクトップ通知（Shell_NotifyIconW）がシェルに登録されない"
description: Electrobunのshow Notification実装がメッセージ専用ウィンドウをタスクトレイアイコンのオーナーにしているため、Windows実機では通知が画面にも通知センターにも一切現れない。niwaterm側でPowerShell経由のWinRT Toast実装に切り替えて回避した
---

# Windows実機: Electrobunのデスクトップ通知（Shell_NotifyIconW）がシェルに登録されない

## 症状

Windows実機で`niwa.notify`/`niwa notify`/`POST /notify`（いずれもElectrobunの`Utils.showNotification()`を呼ぶ）を実行しても、画面に通知が一切表示されない。アプリのログには`Notification shown: <title>`と出て一見成功しているように見えるが、通知センター（タスクバー時計クリックで開くパネル）には「新しい通知はありません」としか出ず、「設定→システム→通知」の「アプリやその他の送信者からの通知」一覧にniwatermが登場しない（同じ一覧に別アプリのWezTermは登場する）。

## 根本原因

Electrobunのソース（GitHub `blackboardsh/electrobun`、`package/src/native/win/nativeWrapper.cpp`の`showNotification`実装）を確認したところ、モダンなWinRT `ToastNotificationManager`ではなく、レガシーな`Shell_NotifyIconW`（`NIM_ADD`/`NIM_MODIFY` + `NIIF_INFO` + `NOTIFYICON_VERSION_4`）でバルーン通知を出す方式になっていた。

問題は、そのオーナーウィンドウ（`nid.hWnd`）に、アプリ全体でRPC/イベント配送用に使っている**メッセージ専用ウィンドウ**（`CreateWindowW(..., HWND_MESSAGE, ...)`で作られた`MainThreadDispatcher::message_window()`）をそのまま渡している点。Windowsのシェル（Explorer）はメッセージ専用ウィンドウをタスクトレイアイコンのオーナーとして正しく扱えず、`Shell_NotifyIconW(NIM_ADD)`はエラーを返さず「成功したように見える」が、実際にはシェル側にアイコンが一切登録されない。

AUMID（Application User Model ID）の未登録が原因ではないことも切り分け済み——`Shell_NotifyIconW`のバルーン方式はAUMID登録を必要としないレガシーAPIであることをソースから確認している。niwaterm側のコードではなく、Electrobun側のネイティブ実装のバグと判断した（GitHub issueを検索したが該当する既存報告は見当たらなかった）。

## 切り分けの経緯

| 確認 | 結果 |
| --- | --- |
| アプリログを確認 | `Notification shown: <title>`と出ており、コード上はエラーなく完了しているように見えた |
| 通知センター（タスクバー時計クリック）を開く | 「新しい通知はありません」 |
| 設定アプリの「システム→通知」を開く | 全体トグルはオン。ただし「アプリやその他の送信者からの通知」一覧にniwaterm-devが存在しない（WezTermは存在する） |
| 「通知領域アイコン」設定パネル（`explorer.exe shell:::{05d7b0f4-2121-4eff-bf6b-ed3f69b894d9}`で直接開ける）を開く | エントリが0件。タスクトレイへのアイコン登録自体が行われていないと確定 |
| Electrobun本体のソースを`gh api`で取得し`showNotification`実装を確認 | `Shell_NotifyIconW`のオーナーウィンドウが`HWND_MESSAGE`配下のメッセージ専用ウィンドウだと特定 |

## 対処方法

niwaterm側でWindows専用の代替実装を追加した（`src/bun/windows-notification.ts`）。PowerShell経由でWinRT `Windows.UI.Notifications.ToastNotificationManager`を直接呼ぶ。AUMIDはショートカット登録なしで動くよう、`HKCU\SOFTWARE\Classes\AppUserModelId\<AppId>`へ自己登録してから使う。Windows標準搭載のPowerShell 5.1だけで完結し、追加インストールは不要（`powertoast`等のnpmライブラリはクリック対応にPowerShell 7.1以上を要求するため見送った）。

`Bun.spawn(["powershell.exe", "-EncodedCommand", <base64>])`で実行する。title/bodyはPowerShellのシングルクォート文字列リテラルとしてエスケープしてから埋め込み、XMLエスケープは`[System.Security.SecurityElement]::Escape()`に委譲することで、PowerShellコマンドインジェクションとXMLインジェクションの両方を防いでいる。

`src/bun/index.ts`で`process.platform === "win32"`ならこの実装を使う分岐にした（macOSはクリックで通知元タブへ遷移させるため、別の自前実装`src/bun/mac-notification.ts`を使う）。

クリック時のアクティベーション（トースト側の`ToastActivated`相当、クリックで通知元タブへフォーカスを移す機能）は、常駐プロセスかCOM Activator登録が必要で実装コストが大きいため、現時点では対応していない（表示のみ）。将来対応する場合はこのファイルの回避策実装が起点になる。

## 関連

- [設定ファイル](/guide/config.md) — `niwa.notify`（niwa APIの一覧）
- [CLIリファレンス](/guide/cli.md) — `niwa notify`
- `src/bun/windows-notification.ts` — PowerShell経由のWinRT Toast実装本体
- `src/bun/index.ts` — `process.platform`によるsendNotificationの分岐
- `src/bun/niwa-api.ts` — `niwa.notify`
- `src/bun/ipc-server.ts` — `POST /notify`エンドポイント
- `packages/cli/src/commands/notify.ts` — `niwa notify`コマンド
- `packages/config/src/niwa.ts` — `NiwaNotifyOptions`型
