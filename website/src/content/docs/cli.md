---
title: CLIからの操作
description: niwaterm CLI（niwatermコマンド）の全コマンドの一覧と、操作対象の省略・ドキュメントの読み方
---

niwatermは、`niwa`コマンド（CLI）からも操作できる。タイルを分割する、タブへキーを送る、画面の内容を取るといった操作を、スクリプトやAIエージェントから呼べる。コマンドは`niwa tab new`のように、操作する対象ごとにまとまっている。使えるようにする手順は[セットアップ](/niwaterm/getting-started/)を参照。

## コマンド一覧

詳しい説明は、そのコマンドが関わる機能のページにある。オプションだけ確かめたいときは`niwaterm <command> --help`でも出せる。

| コマンド                                                    | できること                                                          | 説明                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ping`                                                      | アプリが動いているか確かめる                                        | [基本のコマンド](/niwaterm/cli/commands/#アプリが動いているか確かめるping)   |
| `list`                                                      | ワークスペース・Board・タイル・タブの階層を表示する（`--json`も可） | [基本のコマンド](/niwaterm/cli/commands/#今の状態を見るlist)                 |
| `init`                                                      | 設定ディレクトリの雛形を作る                                        | [セットアップ](/niwaterm/getting-started/#設定ディレクトリを作る)            |
| `window new` / `list` / `close`                             | OSウィンドウを開く・一覧する・閉じる                                | [基本のコマンド](/niwaterm/cli/commands/#メインウィンドウと一時ウィンドウ)   |
| `workspace new` / `switch` / `close` / `rename` / `move`    | ワークスペースを操作する                                            | [基本のコマンド](/niwaterm/cli/commands/)                                    |
| `board new` / `switch` / `close` / `rename` / `move`        | Boardを操作する                                                     | [基本のコマンド](/niwaterm/cli/commands/)                                    |
| `board phase set` / `clear` / `show`                        | Boardの作業フェーズを付け外しする                                   | [基本のコマンド](/niwaterm/cli/commands/)                                    |
| `board startup layout` / `restore` / `clear`                | Boardの起動時レイアウトを切り替える                                 | [レイアウトプリセット](/niwaterm/layouts/#起動時レイアウト)                  |
| `board resume set` / `clear` / `show`                       | 起動時にコマンドを再実行するかをBoardごとに切り替える               | [起動時にコマンドを再実行](/niwaterm/resume/#boardごとに切り替える)          |
| `board worktree set` / `clear` / `show`                     | Boardに紐づくワークツリーを設定する                                 | [ワークツリー](/niwaterm/worktrees/#boardに紐づくワークツリー)               |
| `tile split` / `focus` / `resize` / `zoom`                  | タイルを分割・移動・拡大する                                        | [基本のコマンド](/niwaterm/cli/commands/)                                    |
| `tab new` / `close` / `restart` / `switch`                  | タブを作る・閉じる・再起動する・切り替える                          | [基本のコマンド](/niwaterm/cli/commands/)                                    |
| `tab send-keys`                                             | タブへキーを送る                                                    | [基本のコマンド](/niwaterm/cli/commands/#キーを送るtab-send-keys)            |
| `tab capture`                                               | タブの画面の内容をテキストで取る                                    | [基本のコマンド](/niwaterm/cli/commands/#画面の内容を取るtab-capture)        |
| `tab var set` / `get` / `list` / `find`                     | タブごとの変数を読み書きする                                        | [基本のコマンド](/niwaterm/cli/commands/#タブ変数tab-var)                    |
| `tab focus`                                                 | タブを前面に出して目で確かめられるようにする                        | [ブラウザタブ](/niwaterm/browser/#cliから操作する)                           |
| `tab hover list` / `reveal` / `hide`                        | ホバーボタンを確認する・出したままにする                            | [ホバーボタン](/niwaterm/hover-buttons/)                                     |
| `popup open` / `close` / `toggle` / `promote`               | ポップアップを開く・閉じる・タブへ昇格する                          | [基本のコマンド](/niwaterm/cli/commands/#ポップアップpopup)                  |
| `layout list` / `apply`                                     | レイアウトプリセットを一覧・適用する                                | [レイアウトプリセット](/niwaterm/layouts/)                                   |
| `worktree new` / `open` / `list` / `remove`                 | gitワークツリーをBoardとして開く・削除する                          | [ワークツリー](/niwaterm/worktrees/)                                         |
| `sidebar switch`                                            | サイドバーのビューを切り替える                                      | [カスタムビュー](/niwaterm/custom-views/)                                    |
| `status-bar refresh` / `toggle`                             | ステータスバーを描き直す・隠す                                      | [ステータスバー](/niwaterm/status-bar/)                                      |
| `browser navigate` / `get-text` / `get-html` / `screenshot` | ブラウザタブを操作する・内容を取る                                  | [ブラウザタブ](/niwaterm/browser/)                                           |
| `notify`                                                    | デスクトップ通知を出す                                              | [ベルと通知](/niwaterm/bell/)                                                |
| `font-size increase` / `decrease` / `reset`                 | フォントサイズを変える                                              | [外観](/niwaterm/appearance/#フォントと文字の色)                             |
| `keybind list`                                              | 有効なキーバインドを一覧する                                        | [キーバインド](/niwaterm/keybindings/)                                       |
| `config show`                                               | いま反映されている設定値を表示する                                  | [基本のコマンド](/niwaterm/cli/commands/#設定が反映されないときconfig-show)  |
| `shell-profile list`                                        | シェルプロファイルを一覧する                                        | [シェルとターミナル](/niwaterm/shell/)                                       |
| `agent setup`                                               | Codex CLI・Claude Codeのhooksを入れる                               | [AIエージェント連携](/niwaterm/agents/)                                      |
| `claude prompt list` / `show`                               | Claude Codeの会話記録を読む                                         | [ホバーボタン](/niwaterm/hover-buttons/#claude-codeのプロンプトの目次を出す) |
| `complete <shell>`                                          | シェルの補完スクリプトを出す                                        | [シェル統合と補完](/niwaterm/shell-integration/#シェル補完)                  |
| `docs list` / `show`                                        | このドキュメントをターミナルで読む                                  | [このページ](#ヘルプとドキュメント)                                          |

## 対象IDの省略

多くのコマンドは`--tile`・`--tab`・`--board`・`--workspace`を省略できる。省略すると、**そのコマンドを実行しているタブ**が対象になる。niwaterm以外のターミナルやスクリプトから実行した場合は、フォーカス中のタイルと、そのタイルで表示中のタブが対象になる。

ウィンドウが複数開いているときは、実行しているタブがあるウィンドウが対象になる。niwaterm以外から実行した場合は、最後にフォーカスしたウィンドウが対象になる。

`--tab`だけを指定して`--tile`を省略すると、指定したタブがあるタイルが対象になる。存在しないIDを渡したときは、ほかの対象に置き換えずにエラーになる。

## ヘルプとドキュメント

`--help`はどのコマンドにも付けられ、そのコマンドのオプションを一覧する。

```sh
niwa --help
niwa ping --help
```

```sh
niwa docs list [--json]
niwa docs show <name>
```

このドキュメントサイトの各ページは、ターミナルでも読める。`niwa docs list`でページの一覧を`name<TAB>description`の形で出し、`niwa docs show <name>`でそのページを出す。AIエージェントにniwatermを操作させるとき、CLIだけでドキュメントを読ませられる。`--json`を付けると、一覧をJSONで出す。

`name`は、ドキュメントサイトのURLのうち`/niwaterm/`より後ろの部分と同じ（`/niwaterm/keybindings/api/`なら`keybindings/api`）。トップページは一覧に出ない。
