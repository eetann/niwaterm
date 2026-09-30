---
title: CLIからの操作
description: niwaterm CLI（niwatermコマンド）の全コマンドの一覧と、操作対象の省略・ドキュメントの読み方
---

niwatermは、`niwaterm`コマンド（CLI）からも操作できる。タイルを分割する、タブへキーを送る、画面の内容を取るといった操作を、スクリプトやAIエージェントから呼べる。コマンドは`niwaterm tab new`のように、操作する対象ごとにまとまっている。使えるようにする手順は[セットアップ](/niwaterm/getting-started/)を参照。

## コマンド一覧

詳しい説明は、そのコマンドが関わる機能のページにある。オプションだけ確かめたいときは`niwaterm <command> --help`でも出せる。

| コマンド                                                    | できること                                          | 説明                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| `ping`                                                      | アプリが動いているか確かめる                        | [基本のコマンド](/niwaterm/cli/commands/#状態を確認するping--list)       |
| `list`                                                      | ワークスペース・Board・タイル・タブの階層を表示する | [基本のコマンド](/niwaterm/cli/commands/#状態を確認するping--list)       |
| `init`                                                      | 設定ディレクトリの雛形を作る                        | [セットアップ](/niwaterm/getting-started/#設定ディレクトリを作る)        |
| `window new` / `list` / `close`                             | OSウィンドウを開く・一覧する・閉じる                | [基本のコマンド](/niwaterm/cli/commands/#ウィンドウwindow)               |
| `workspace new` / `switch` / `close` / `rename` / `move`    | ワークスペースを操作する                            | [基本のコマンド](/niwaterm/cli/commands/#ワークスペースworkspace)        |
| `board new` / `switch` / `close` / `rename` / `move`        | Boardを操作する                                     | [基本のコマンド](/niwaterm/cli/commands/#boardboard)                     |
| `board phase set` / `clear` / `show`                        | Boardの作業フェーズを付け外しする                   | [基本のコマンド](/niwaterm/cli/commands/#boardboard)                     |
| `board startup layout` / `restore` / `clear`                | Boardの起動時レイアウトを切り替える                 | [レイアウトプリセット](/niwaterm/layouts/#起動時レイアウト)              |
| `board worktree set` / `clear` / `show`                     | Boardに紐づくワークツリーを設定する                 | [ワークツリー](/niwaterm/worktrees/#boardに紐づくワークツリー)           |
| `tile split` / `focus` / `resize` / `zoom`                  | タイルを分割・移動・拡大する                        | [基本のコマンド](/niwaterm/cli/commands/#タイルとタブtile--tab)          |
| `tab new` / `close` / `restart` / `switch`                  | タブを作る・閉じる・再起動する・切り替える          | [基本のコマンド](/niwaterm/cli/commands/#タイルとタブtile--tab)          |
| `tab send-keys`                                             | タブへキーを送る                                    | [基本のコマンド](/niwaterm/cli/commands/#キーを送るtab-send-keys)        |
| `tab capture`                                               | タブの画面の内容をテキストで取る                    | [基本のコマンド](/niwaterm/cli/commands/#画面の内容を取るtab-capture)    |
| `tab var set` / `get` / `list` / `find`                     | タブごとの変数を読み書きする                        | [基本のコマンド](/niwaterm/cli/commands/#タブ変数tab-var)                |
| `tab focus`                                                 | タブを前面に出して目で確かめられるようにする        | [ブラウザタブ](/niwaterm/browser/#cliから操作する)                       |
| `tab hover list` / `reveal` / `hide`                        | ホバーボタンを確認する・出したままにする            | [ホバーボタン](/niwaterm/hover-buttons/)                                 |
| `popup open` / `close` / `toggle` / `promote`               | ポップアップを開く・閉じる・タブへ昇格する          | [基本のコマンド](/niwaterm/cli/commands/#ポップアップpopup)              |
| `layout list` / `apply`                                     | レイアウトプリセットを一覧・適用する                | [レイアウトプリセット](/niwaterm/layouts/)                               |
| `worktree new` / `open` / `list` / `remove`                 | gitワークツリーをBoardとして開く・削除する          | [ワークツリー](/niwaterm/worktrees/)                                     |
| `sidebar switch`                                            | サイドバーのビューを切り替える                      | [カスタムビュー](/niwaterm/custom-views/)                                |
| `status-bar refresh` / `toggle`                             | ステータスバーを描き直す・隠す                      | [ステータスバー](/niwaterm/status-bar/)                                  |
| `browser navigate` / `get-text` / `get-html` / `screenshot` | ブラウザタブを操作する・内容を取る                  | [ブラウザタブ](/niwaterm/browser/)                                       |
| `notify`                                                    | デスクトップ通知を出す                              | [ベルと通知](/niwaterm/bell/)                                            |
| `font-size increase` / `decrease` / `reset`                 | フォントサイズを変える                              | [基本のコマンド](/niwaterm/cli/commands/#フォントサイズfont-size)        |
| `keybind list`                                              | 有効なキーバインドを一覧する                        | [基本のコマンド](/niwaterm/cli/commands/#キーバインドの一覧keybind-list) |
| `config show`                                               | いま反映されている設定値を表示する                  | [基本のコマンド](/niwaterm/cli/commands/#設定値の確認config-show)        |
| `shell-profile list`                                        | シェルプロファイルを一覧する                        | [シェルとターミナル](/niwaterm/shell/)                                   |
| `agent setup`                                               | Codex CLI・Claude Codeのhooksを入れる               | [AIエージェント連携](/niwaterm/agents/)                                  |
| `claude prompt list` / `show`                               | Claude Codeの会話記録を読む                         | [AIエージェント連携](/niwaterm/agents/#claude-codeのセッション参照)      |
| `complete <shell>`                                          | シェルの補完スクリプトを出す                        | [シェル統合と補完](/niwaterm/shell-integration/#シェル補完)              |
| `docs list` / `show`                                        | このドキュメントをターミナルで読む                  | [このページ](#ヘルプとドキュメント)                                      |

## 対象IDの省略

多くのコマンドは`--tile`・`--tab`・`--board`・`--workspace`を省略できる。省略すると、**そのコマンドを実行しているタブ**が対象になる。niwaterm以外のターミナルやスクリプトから実行した場合は、フォーカス中のタイルと、そのタイルで表示中のタブが対象になる。

ウィンドウが複数開いているときは、実行しているタブがあるウィンドウが対象になる。niwaterm以外から実行した場合は、最後にフォーカスしたウィンドウが対象になる。

`--tab`だけを指定して`--tile`を省略すると、指定したタブがあるタイルが対象になる。存在しないIDを渡したときは、ほかの対象に置き換えずにエラーになる。

次のオプションは省略できない。

- 切り替え先を指す`tab switch`の`--tab`・`--direction`、`board switch --board`、`workspace switch --workspace`
- 別のタブへ誤ってキーを送らないよう、`tab send-keys`の`--tab`
- ブラウザタブを指す`browser`系の`--tab`

`tab var set`・`get`・`list`の`--tab`は、省略するとそのコマンドを実行しているタブが対象になる。niwaterm以外から実行した場合はエラーになり、フォーカス中のタブには書き込まない。

## ヘルプとドキュメント

`--help`はどのコマンドにも付けられ、そのコマンドのオプションを一覧する。

```sh
niwaterm --help
niwaterm ping --help
```

```sh
niwaterm docs list [--json]
niwaterm docs show <name>
```

このドキュメントサイトの各ページは、ターミナルでも読める。`niwaterm docs list`でページの一覧を`name<TAB>description`の形で出し、`niwaterm docs show <name>`でそのページを出す。AIエージェントにniwatermを操作させるとき、CLIだけでドキュメントを読ませられる。`--json`を付けると、一覧をJSONで出す。

`name`は、ドキュメントサイトのURLのうち`/niwaterm/`より後ろの部分と同じ（`/niwaterm/keybindings/api/`なら`keybindings/api`）。トップページは一覧に出ない。
