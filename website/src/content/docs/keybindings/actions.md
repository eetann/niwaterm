---
title: アクション一覧
description: キーバインドに割り当てられる動作の名前と、デフォルトのキーの一覧
---

`niwa.keybind("d", "split-vertical")`のように、キーに割り当てられる動作（アクション）の一覧。デフォルトのキーはprefixキーのあとに押すキーで、「—」のものはキーが割り当てられていない。キーがなくても、コマンドパレット（prefix + `:`）から名前で探して実行できる。割り当て方は[キーバインド](/niwaterm/keybindings/)を参照。

## タイル

| アクション                                                   | 動作                                                       | デフォルトのキー                 |
| ------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------- |
| `split-vertical` / `split-horizontal`                        | タイルを左右 / 上下に分割する                              | `d` / `shift+d`                  |
| `close-tile`                                                 | フォーカス中のタブを閉じる。最後のタブならタイルごと閉じる | `w`                              |
| `focus-up` / `focus-down` / `focus-left` / `focus-right`     | 隣のタイルへフォーカスを移す                               | `up` / `down` / `left` / `right` |
| `resize-up` / `resize-down` / `resize-left` / `resize-right` | フォーカス中のタイルをその方向へ少し広げる                 | —                                |
| `toggle-zoom`                                                | フォーカス中のタイルだけを画面いっぱいに広げる / 元に戻す  | `z`                              |

`resize-*`は、[続けて押せるように](/niwaterm/keybindings/#続けて押せるようにする)して割り当てると使いやすい。

## タブ

| アクション              | 動作                                                                 | デフォルトのキー |
| ----------------------- | -------------------------------------------------------------------- | ---------------- |
| `new-tab`               | ターミナルのタブを開く                                               | `t`              |
| `new-browser-tab`       | [ブラウザ](/niwaterm/browser/)のタブを開く                           | `shift+t`        |
| `new-custom-view-tab`   | 最初の[カスタムビュー](/niwaterm/custom-views/)をタブで開く          | —                |
| `focus-url-bar`         | ブラウザタブのURL欄へフォーカスする                                  | `u`              |
| `next-tab` / `prev-tab` | 次 / 前のタブへ切り替える                                            | `n` / `p`        |
| `rename-tab`            | タブの名前を変える                                                   | `r`              |
| `restart-tab`           | タブで動いているプログラムを終了して起動し直す（実行前に確認が出る） | —                |

## Board

[Board](/niwaterm/boards/)の追加・切り替えや、フェーズ・ワークツリーの設定。

| アクション                          | 動作                                                                           | デフォルトのキー |
| ----------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| `new-board`                         | Boardを追加する                                                                | `c`              |
| `close-board`                       | Boardを中のタブごと閉じる（実行前に確認が出る）                                | —                |
| `next-board` / `prev-board`         | 同じワークスペースの次 / 前のBoardへ切り替える                                 | —                |
| `rename-board`                      | Boardの名前を変える                                                            | `,`              |
| `move-board-up` / `move-board-down` | サイドバーでのBoardの並びを1つ上 / 下へ動かす                                  | —                |
| `move-board-to-workspace`           | Boardを別のワークスペースへ移す                                                | —                |
| `set-board-phase`                   | Boardの[作業フェーズ](/niwaterm/boards/#作業フェーズを付ける)を候補から選ぶ    | —                |
| `set-board-phase:<id>`              | Boardの作業フェーズを`<id>`のものにする。候補を選ばずに1回で切り替えたいとき用 | —                |
| `clear-board-phase`                 | Boardの作業フェーズを外す                                                      | —                |
| `set-board-worktree`                | Boardに[ワークツリー](/niwaterm/worktrees/)を紐づける                          | —                |
| `clear-board-startup`               | Boardに紐づけた[起動時のレイアウト](/niwaterm/layouts/#起動時レイアウト)を外す | —                |

## ワークスペースとウィンドウ

| アクション                                  | 動作                                                      | デフォルトのキー |
| ------------------------------------------- | --------------------------------------------------------- | ---------------- |
| `new-workspace`                             | ワークスペースを追加する                                  | `shift+n`        |
| `next-workspace` / `prev-workspace`         | 次 / 前のワークスペースへ切り替える                       | `]` / `[`        |
| `rename-workspace`                          | ワークスペースの名前を変える                              | —                |
| `close-workspace`                           | ワークスペースを中のBoardごと閉じる（実行前に確認が出る） | —                |
| `move-workspace-up` / `move-workspace-down` | サイドバーでのワークスペースの並びを1つ上 / 下へ動かす    | —                |
| `new-window`                                | 新しいウィンドウを開く                                    | `shift+w`        |
| `close-window`                              | ウィンドウを閉じる（実行前に確認が出る）                  | —                |

## サイドバー・ステータスバー・ポップアップ

| アクション                                | 動作                                                                                                         | デフォルトのキー |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| `toggle-sidebar`                          | サイドバーを表示する / 隠す                                                                                  | `b`              |
| `next-sidebar-view` / `prev-sidebar-view` | サイドバーに出すビュー（ワークスペース一覧と[カスタムビュー](/niwaterm/custom-views/)）を次 / 前へ切り替える | `shift+b` / —    |
| `show-sidebar-view:<id>`                  | サイドバーに出すビューを`<id>`のものにする。ワークスペース一覧に戻すときは`workspaces`                       | —                |
| `toggle-status-bar`                       | [ステータスバー](/niwaterm/status-bar/)を表示する / 隠す                                                     | —                |
| `refresh-status-bar`                      | ステータスバーの表示を更新する                                                                               | —                |
| `toggle-popup`                            | [ポップアップ](/niwaterm/concepts/#ポップアップ)を開く / 閉じる                                              | `` ` ``          |
| `promote-popup`                           | ポップアップの中身を、フォーカス中のタイルのタブとして移す                                                   | —                |

## 移動・コピー・スクロール

| アクション                            | 動作                                                                            | デフォルトのキー                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `jump-hint`                           | [ジャンプヒント](/niwaterm/jump-and-copy/#ジャンプヒント)を出す                 | `f`                                                                              |
| `copy-mode`                           | [コピーモード](/niwaterm/jump-and-copy/#コピーモードvi風のキーボード選択)に入る | `v`                                                                              |
| `copy-selection` / `paste-clipboard`  | 選択した文字をコピーする / クリップボードの内容を貼り付ける                     | macOSは`cmd+c` / `cmd+v`、Windowsは`ctrl+shift+c` / `ctrl+shift+v`（prefixなし） |
| `scroll-page-up` / `scroll-page-down` | 1ページ分スクロールする                                                         | `pageup` / `pagedown`                                                            |
| `scroll-to-top` / `scroll-to-bottom`  | スクロールバックの先頭 / 最新の行へ飛ぶ                                         | `home` / `end`                                                                   |
| `jump-prompt-up` / `jump-prompt-down` | 前 / 次のプロンプトへ飛ぶ（[シェル統合](/niwaterm/shell-integration/)が必要）   | `shift+up` / `shift+down`                                                        |

## アプリ全体

| アクション                                                      | 動作                                                                                 | デフォルトのキー |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------- |
| `command-palette`                                               | コマンドパレットを開く                                                               | `:`              |
| `increase-font-size` / `decrease-font-size` / `reset-font-size` | 文字を大きく / 小さく / 元の大きさにする                                             | `=` / `-` / `0`  |
| `show-config`                                                   | [今の設定](/niwaterm/getting-started/#現在の設定値を確認する)を表示する              | `i`              |
| `reload-config`                                                 | 設定ファイルを読み込み直す                                                           | —                |
| `quit-app`                                                      | niwatermを終了する。開いていた画面は次に起動したときに元に戻る（実行前に確認が出る） | —                |
