---
title: CLIからの操作
description: niwaterm CLI（niwatermコマンド）の全コマンドの一覧と、操作対象の省略・ドキュメントの読み方
---

niwatermアプリはunix socket経由のIPCサーバーを持ち、`niwaterm`コマンド（CLI）から操作できる。コマンドは`niwaterm <resource> <verb>`の形で、操作する対象（リソース）ごとにまとまっている。使えるようにする手順は[セットアップ](/niwaterm/getting-started/)を参照。

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

多くのコマンドは`--tile`/`--tab`/`--board`/`--workspace`を省略でき、その場合は**そのコマンドを実行しているタブ**が対象になる。niwatermが起動したシェルには`NIWATERM_TAB_ID`環境変数が入っており、CLIはそれを起点に所属タイル・Board・ワークスペースを解決する。niwatermの外（普通のターミナル・スクリプト）から実行した場合は、アクティブなワークスペース→アクティブなBoard→フォーカス中タイル→そのアクティブタブへフォールバックする（tmuxの`current-pane`相当）。

ウィンドウが複数開いている場合、フォールバック先は**実行しているタブが載っているウィンドウ**になる（CLIは全リクエストに`NIWATERM_TAB_ID`を添えて送る）。niwatermの外から実行した場合は最後にフォーカスされたウィンドウが対象になる。`workspace new`・`popup open`のように対象IDを取らないコマンドも同じ規則で宛先のウィンドウが決まる。

明示指定した値がこの解決結果で上書きされることはない。存在しないIDを渡しても別の対象へすり替わらず、そのままエラーになる。`--tab`だけを指定して`--tile`を省略した場合は、実行元ではなく**指定したタブが属するタイル**が埋まる（`tab close --tab <tabId>`のような使い方ができる）。

省略できないのは、自分自身を指しても意味が無い切り替え系（`tab switch`の`--tab`/`--direction`、`board switch --board`、`workspace switch --workspace`）、誤送信を避けたい`tab send-keys --tab`、対象がブラウザタブに限られる`browser *`の`--tab`。`tab var`系の`--tab`は`NIWATERM_TAB_ID`のみを見て、フォーカス中タブへのフォールバックは行わない（シェル統合・エージェント統合のhookがniwaterm外で暴発しないようにするため）。

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

`niwaterm docs list`は利用可能なドキュメントトピックを`name<TAB>description`形式で表示する。`--json`を付けると、トピックの配列と次の操作を示す`help`を持つJSONで出力する。`niwaterm docs show <name>`はそのトピックのドキュメントそのものをターミナルへ出力する。リポジトリを直接読めない状況（AIエージェントがCLI経由でniwatermを操作する場合など）でも、CLIだけでドキュメント全体を取得できる。

トピックはドキュメントサイトのページ（`website/src/content/docs/`配下の`.md`）から組み立てられる。`name`はそこからの相対パスで拡張子を除いたもの（`keybindings/api.md`なら`keybindings/api`）で、説明にはfrontmatterの`description`をそのまま使う。ページを増やせば一覧にも載るので、CLI側にトピックを登録する必要はない。トップページのような`.mdx`のページは、ターミナルでは読みにくいので一覧に載せない。
