---
type: Reference
title: CLIからの操作
description: niwaterm CLI（niwatermコマンド）のセットアップとサブコマンド一覧
---

# CLIからの操作

niwatermアプリはunix socket経由のIPCサーバーを持ち、`niwaterm`コマンド（CLI）から操作できる。疎通確認（`niwaterm ping`）、ワークスペース・タイル・タブの一覧取得（`niwaterm list`）、特定タブへのキー送信（`niwaterm send-keys`）、タイル分割・タブ作成・タブ切替・タブを閉じる・タイルへのフォーカス移動（`niwaterm split-tile`/`new-tab`/`switch-tab`/`close-tab`/`focus-tile`）、ワークスペースの作成・切替・削除・名前変更（`niwaterm new-workspace`/`switch-workspace`/`close-workspace`/`rename-workspace`）、レイアウトプリセットの一覧・適用（`niwaterm layout list`/`layout apply`）、特定タブの画面内容取得（`niwaterm capture-tab`）、タブ変数の設定・取得・一覧（`niwaterm set-var`/`get-var`/`list-vars`）、ブラウザタブのURL遷移・画面内容取得・スクリーンショット取得（`niwaterm browser-navigate`/`browser-get-text`/`browser-get-html`/`browser-screenshot`）、任意タブの目視確認用アクティブ化（`niwaterm show-tab`）、このドキュメント自体のCLI経由での閲覧（`niwaterm docs`）に対応。AIエージェントがCLIを操作する際は、リポジトリを直接読まなくても`niwaterm docs show cli`でこのドキュメントを取得できる。

## セットアップ

```sh
cd packages/cli
bun link
```

`bin`フィールド経由で`niwaterm`コマンドがグローバル（`~/.bun/bin`）に登録される。`~/.bun/bin`がPATHに含まれていない場合は追加する。

このリポジトリの絶対パスに依存するシンボリックリンクになるため、リポジトリを移動・削除すると`niwaterm`コマンドは壊れる。

## 使い方

```sh
niwaterm ping
```

niwatermアプリが起動していれば`pong (pid <アプリのpid>)`が返る（終了コード0）。アプリが起動していない、またはIPCサーバーに接続できない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm list
```

ワークスペース→タイル→タブの階層構造を表示する。アクティブなワークスペース/フォーカス中タイル/アクティブタブにはそれぞれ`(active)`/`(focused)`のサフィックスが付く。`send-keys`で指定するtabIdはここで確認する。

```sh
niwaterm send-keys --tab <tabId> <keys...>
```

指定したタブへキーを送信する（tmuxの`send-keys`相当）。`<keys...>`にはリテラル文字列と特殊キー名を複数個並べて混在指定できる。

```sh
niwaterm send-keys --tab tab-3 'ls -la' Enter
niwaterm send-keys -t tab-3 C-c
```

対応する特殊キー名: `Enter`, `Escape`, `Tab`, `Space`, `BSpace`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `Delete`, `PageUp`, `PageDown`。`C-a`〜`C-z`（英字のみ）でCtrl修飾も送れる。上記以外の文字列はリテラルとしてそのままPTYへ送信される。指定したtabIdが存在しない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm split-tile --tile <tileId> [--orientation horizontal|vertical]
niwaterm new-tab --tile <tileId> [--url <url> | --custom-view | [--shell <shellProfileId>] [--cwd <dir>]]
niwaterm switch-tab --tile <tileId> --tab <tabId>
niwaterm close-tab --tile <tileId> --tab <tabId>
niwaterm focus-tile --tile <tileId>
```

レイアウト操作コマンド。いずれも対象の`tileId`/`tabId`は`niwaterm list`で確認する。

- `split-tile` — 指定タイルを分割する（`--orientation`省略時は`vertical`）。成功時、新規に作られた`tileId`/`tabId`を表示する
- `new-tab` — 指定タイルに新規タブを作成する。`--url`指定時はそのURLを開くブラウザタブ、`--custom-view`指定時は`niwaterm.config.ts`の`customView`設定を開くブラウザタブ、`--shell`指定時はそのシェルプロファイル（idは`niwaterm shell-profiles`で確認）でターミナルタブ、いずれも省略時はデフォルトシェルの通常のターミナルタブを作成する（`--url`・`--custom-view`・`--shell`は互いに同時指定不可）。`--cwd`で作業ディレクトリを指定できる（ターミナルタブ専用。`--shell`とは併用可、`--url`・`--custom-view`とは同時指定不可）。成功時、新規`tabId`を表示する
- `switch-tab` — 指定タイル内でアクティブタブを切り替える
- `close-tab` — 指定タブを閉じる（tmuxの`kill-window`相当）。ワークスペース最後の1枚のタイルの最後のタブは誤操作防止のため閉じられない
- `focus-tile` — 指定タイルへフォーカスを移す

いずれも対象の`tileId`/`tabId`が存在しない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm new-workspace
niwaterm switch-workspace --workspace <workspaceId>
niwaterm close-workspace --workspace <workspaceId>
niwaterm rename-workspace --workspace <workspaceId> <name>
```

ワークスペース単位の操作コマンド。対象の`workspaceId`は`niwaterm list`で確認する。

- `new-workspace` — 新規ワークスペースを作成し、アクティブにする。成功時、新規`workspaceId`を表示する
- `switch-workspace` — 指定したワークスペースへ切り替える
- `close-workspace` — 指定したワークスペースを閉じる。最後の1つのワークスペースは誤操作防止のため閉じられない
- `rename-workspace` — 指定したワークスペースの名前を変更する（サイドバーの見出しラベルに反映される）。`<name>`に空文字列を指定するとデフォルトの連番ラベル（`Workspace N`）へ戻る。タブ名・タイル名同様、アプリ再起動をまたいだ永続化はしない

いずれも対象の`workspaceId`が存在しない場合、`close-workspace`はさらに最後の1つを指定した場合もエラーメッセージと共に終了コード1を返す。

```sh
niwaterm layout list
niwaterm layout apply <name> [--new-workspace | --replace] [--cwd <dir>]
```

`niwaterm.config.ts`の`layouts`（詳細: `docs/guide/config.md`「レイアウト」節）で定義したプリセットを一覧・適用する（[vde-layout](https://github.com/yuki-yano/vde-layout)ライク）。

- `layout list` — 定義済みプリセットを`name<TAB>description`形式で表示する。1件も定義されていない場合はその旨を表示する
- `layout apply <name>` — 指定したプリセットを適用する。`--new-workspace`（デフォルト、明示指定も可）は新規ワークスペースとして適用し、成功時にその`workspaceId`を表示する。`--replace`は現在のワークスペースを単一タイルへ畳んでから適用し直す（**既存タブ・PTYは無条件でcloseされる**。確認プロンプト等は無い）。`--new-workspace`と`--replace`は同時指定不可。`--cwd`は各タブの`cwd`未指定時に使う作業ディレクトリで、省略時は`niwaterm layout apply`を実行したディレクトリになる（`--replace`時、それ以上分割されず最初に到達するタイルだけは既存タブを使い回すため、このデフォルトが効かず元のcwdのまま残る）

指定した`name`が未定義の場合、プリセットの検証に失敗した場合（`shellProfile`が未知のid、`focus:true`が2つ以上、ratioが範囲外等）はいずれもエラーメッセージと共に終了コード1を返す。検証失敗時はワークスペースに一切変更を加えない。

```sh
niwaterm shell-profiles
```

利用可能なシェルプロファイル一覧を`id<TAB>name<TAB>command`形式で表示する。`new-tab --shell`に指定する`id`はここで確認する。プロファイルはniwaterm.config.tsの`shell.profiles`（詳細: `docs/guide/config.md`「シェル設定」節）と、Windows環境では起動時に自動検出したWSLディストロ・PowerShellから構成される。1件も無い場合はその旨を表示する。

```sh
niwaterm capture-tab --tab <tabId>
```

指定したタブの現在の画面内容をプレーンテキストで標準出力へ表示する（tmuxの`capture-pane -p`相当）。エスケープシーケンス・色情報は含まれず、現在画面（viewport）の内容のみが対象でスクロールバックは含まれない。指定したtabIdが存在しない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm set-var --tab <tabId> <key> <value>
niwaterm get-var --tab <tabId> <key>
niwaterm list-vars --tab <tabId>
```

タブごとのkey-value変数を設定・取得・一覧する（tmuxのペイン変数、`set-option -p`/`show-options -p`相当）。値は文字列固定、キーは`^[A-Za-z0-9_.-]{1,128}$`（英数字・`_`・`-`・`.`のみ、1〜128文字）のみ許可する。**変数は永続化されず、アプリを終了する・対象タブを閉じると消える**（tabId自体がアプリ再起動のたびに再採番されるため）。`tabId`を指定すればどのタブからでも別タブの変数を読み書きできるため、送信元タブが自身の状態を`set-var`で書き、別タブがその値を`get-var`で参照しつつ`send-keys`で操作する、といったタブ間の自動化に使える。指定した`tabId`が存在しない場合、または`get-var`で指定した`key`が未設定の場合はエラーメッセージと共に終了コード1を返す。

`--tab`は省略可能で、その場合`NIWATERM_TAB_ID`環境変数を使う。niwaterm内で起動したシェルにはこの環境変数が自動設定されているため、そのタブ自身の変数を読み書きする分にはタブIDを調べる必要がない（別タブの変数を操作する場合は`--tab`を明示する）。シェル統合スクリプト（下記「シェル統合」参照）はこれを利用してブランチ名等を`set-var`する。`--tab`省略かつ`NIWATERM_TAB_ID`も無い（niwaterm外のシェルから実行した等）場合はエラーメッセージと共に終了コード1を返す。

## シェル統合

`contrib/shell-integration/`配下のスクリプトをシェルの起動時にsourceすると、プロンプト表示のたびに現在のgitブランチをタブ変数`branch`へ自動反映する（`niwaterm set-var branch <branch>`相当を内部で呼ぶ）。サイドバーのタブ行にブランチ名が表示されるようになる。zsh/bash/fish/PowerShellに対応している。

```sh
# ~/.zshrc
[ -n "$NIWATERM_TAB_ID" ] && source /path/to/niwaterm/contrib/shell-integration/niwaterm.zsh
```

```sh
# ~/.bashrc
[ -n "$NIWATERM_TAB_ID" ] && source /path/to/niwaterm/contrib/shell-integration/niwaterm.bash
```

```fish
# ~/.config/fish/config.fish
test -n "$NIWATERM_TAB_ID"; and source /path/to/niwaterm/contrib/shell-integration/niwaterm.fish
```

```powershell
# $PROFILE
if ($env:NIWATERM_TAB_ID) { . C:\path\to\niwaterm\contrib\shell-integration\niwaterm.ps1 }
```

`NIWATERM_TAB_ID`が無いシェル（niwaterm外のターミナル）では何もしない。PowerShell版は`prompt`関数を上書きするが、既存の`prompt`関数（他ツールのプロンプトカスタマイズ等）を保持して末尾で呼び直すため、他のプロンプト拡張と共存できる。

## エージェント統合

`contrib/agent-integration/`配下の設定を導入すると、タブ内で動くAIエージェント（Claude Code等）のhooks機構から、そのセッションの状態（idle/working/blocked）をタブ変数`agent`/`agent_status`へ自動反映する（`niwaterm set-var agent_status working`相当を内部で呼ぶ）。サイドバーのタブ行に状態ドットが表示されるようになる。

```sh
# ~/.claude/settings.json（グローバル、全プロジェクト共通で使えるので推奨）の"hooks"キーへ
# contrib/agent-integration/claude-code/hooks.jsonの中身をマージする
cp ~/.claude/settings.json ~/.claude/settings.json.bak
jq -s '.[0] * {hooks: (.[0].hooks * .[1].hooks)}' \
  ~/.claude/settings.json /path/to/niwaterm/contrib/agent-integration/claude-code/hooks.json \
  > /tmp/merged-settings.json
mv /tmp/merged-settings.json ~/.claude/settings.json
```

`branch`と同様、`agent`/`agent_status`もタブ変数の予約キーである（値は`niwaterm set-var`で自由に読み書きできる汎用キーだが、この2つの名前はサイドバー表示用に予約されている）。`agent`はエージェントの種別を表す任意の文字列（Claude Codeは`claude-code`固定）、`agent_status`は`idle`/`working`/`blocked`のいずれか（未設定・未知の値は`idle`扱い）。各hookコマンドは`$NIWATERM_TAB_ID`が無い環境（niwaterm外のプロジェクト・ターミナル）では何もしないガードが入っているため、グローバル設定に追加しても安全（詳細: `contrib/agent-integration/README.md`）。Claude Code以外のエージェントを対応させる場合の規約も同READMEに記載している。

```sh
niwaterm browser-navigate --tab <tabId> --url <url>
niwaterm browser-get-text --tab <tabId>
niwaterm browser-get-html --tab <tabId>
niwaterm browser-screenshot --tab <tabId> --out <path>
niwaterm show-tab --tab <tabId>
```

ブラウザタブをCLIから操作するコマンド（PlaywrightのAPIのような感覚での操作を想定。読み取り中心のMVPで、click/fill等の操作系は未対応）。

- `browser-navigate` — 指定したブラウザタブのURLを遷移する（Playwrightの`page.goto()`相当）。次のページ読み込み完了まで待って結果を返す
- `browser-get-text` — 指定したブラウザタブの表示内容をプレーンテキストで取得する（`document.body.innerText`相当）
- `browser-get-html` — 指定したブラウザタブのHTMLを取得する（`document.documentElement.outerHTML`相当）
- `browser-screenshot` — 指定したブラウザタブの現在URLをheadlessブラウザ（Bun本体がv1.3.12以降ネイティブに提供する`Bun.WebView`、macOSはniwatermのElectrobun側と同じWKWebViewベース）で別途開き直し、スクリーンショットをPNGファイルに保存する。**表示中タブそのものではなく、別インスタンスで同じURLを新規に開いた場合の見た目**になる点に注意（ログイン状態やスクロール位置、フォーム入力中の値などは反映されない）

いずれも対象`tabId`がterminalタブの場合、または存在しない場合はエラーメッセージと共に終了コード1を返す。対象タブの所属ワークスペースが非アクティブ（他のワークスペースを表示中）な場合もエラーになる。その場合は先に`show-tab`で対象ワークスペースをアクティブ化してから呼び直す。

- `show-tab` — 指定したタブが属するワークスペース・タイルへ切り替え、そのタブをアクティブ化し、ウィンドウを前面化する。**AIが普段ヘッドレスでブラウザタブを操作しつつ、人間が確認したい時に任意でその画面を見られるようにするためのコマンド**。`switch-tab`/`focus-tile`と役割が重なって見えるが、粒度が異なる合成コマンドである:
  - `switch-tab --tile --tab` — 同一タイル内でのアクティブタブ切替のみ（ワークスペース非依存、ウィンドウ前面化なし）
  - `focus-tile --tile` — フォーカス（キー入力の宛先）を移すのみ
  - `show-tab --tab` — `tabId`だけを渡せば、内部でワークスペース切替・タイルフォーカス・タブアクティブ化・ウィンドウ前面化までを代行する

「表示中タブそのものの見た目を確認したい」場合は`show-tab`で実ウィンドウを前面化して直接目視するか、`browser-screenshot`で同じURLのheadlessスクショを撮る（後者はDOM状態が再現されない代わりに人間が画面の前にいなくても確認できる）。使い分けの目安として、両者は互いを置き換えるものではない。

```sh
niwaterm --help
niwaterm ping --help
```

```sh
niwaterm docs list
niwaterm docs show cli
```

`niwaterm docs list`は利用可能なドキュメントトピックの一覧、`niwaterm docs show cli`はこのドキュメント（`docs/guide/cli.md`）の内容そのものをターミナルへ出力する。リポジトリを直接読めない状況（AIエージェントがCLI経由でniwatermを操作する場合など）でも、CLIだけでこのドキュメント全体を取得できる。

## AIエージェント向けの導線

- `packages/cli/README.md` — CLIパッケージのセットアップ手順・基本的な使い方
- `.claude/skills/niwaterm-cli/SKILL.md` — Claude Codeなどのエージェントがniwatermを操作する際に自律的に発見できるスキル定義

いずれもコマンドの詳細はこのドキュメント（`niwaterm docs show cli`）への導線に留め、内容を書き写さない。

## スコープ外（roadmap参照）

- npm registryへの公開・実行可能ファイルとしての配布
