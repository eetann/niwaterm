---
type: Reference
title: CLIからの操作
description: niwaterm CLI（niwatermコマンド）のセットアップとサブコマンド一覧
---

# CLIからの操作

niwatermアプリはunix socket経由のIPCサーバーを持ち、`niwaterm`コマンド（CLI）から操作できる。疎通確認（`niwaterm ping`）、ワークスペース・タイル・タブの一覧取得（`niwaterm list`）、特定タブへのキー送信（`niwaterm send-keys`）、タイル分割・タブ作成・タブ切替・タブを閉じる・タイルへのフォーカス移動（`niwaterm split-tile`/`new-tab`/`switch-tab`/`close-tab`/`focus-tile`）、特定タブの画面内容取得（`niwaterm capture-tab`）、タイル変数の設定・取得・一覧（`niwaterm set-var`/`get-var`/`list-vars`）、ブラウザタブのURL遷移・画面内容取得・スクリーンショット取得（`niwaterm browser-navigate`/`browser-get-text`/`browser-get-html`/`browser-screenshot`）、任意タブの目視確認用アクティブ化（`niwaterm show-tab`）、このドキュメント自体のCLI経由での閲覧（`niwaterm docs`）に対応。AIエージェントがCLIを操作する際は、リポジトリを直接読まなくても`niwaterm docs show cli`でこのドキュメントを取得できる。

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
niwaterm new-tab --tile <tileId> [--url <url> | --custom-view | --shell <shellProfileId>]
niwaterm switch-tab --tile <tileId> --tab <tabId>
niwaterm close-tab --tile <tileId> --tab <tabId>
niwaterm focus-tile --tile <tileId>
```

レイアウト操作コマンド。いずれも対象の`tileId`/`tabId`は`niwaterm list`で確認する。

- `split-tile` — 指定タイルを分割する（`--orientation`省略時は`vertical`）。成功時、新規に作られた`tileId`/`tabId`を表示する
- `new-tab` — 指定タイルに新規タブを作成する。`--url`指定時はそのURLを開くブラウザタブ、`--custom-view`指定時は`niwaterm.config.ts`の`customView`設定を開くブラウザタブ、`--shell`指定時はそのシェルプロファイル（idは`niwaterm shell-profiles`で確認）でターミナルタブ、いずれも省略時はデフォルトシェルの通常のターミナルタブを作成する（`--url`・`--custom-view`・`--shell`は互いに同時指定不可）。成功時、新規`tabId`を表示する
- `switch-tab` — 指定タイル内でアクティブタブを切り替える
- `close-tab` — 指定タブを閉じる（tmuxの`kill-window`相当）。ワークスペース最後の1枚のタイルの最後のタブは誤操作防止のため閉じられない
- `focus-tile` — 指定タイルへフォーカスを移す

いずれも対象の`tileId`/`tabId`が存在しない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm shell-profiles
```

利用可能なシェルプロファイル一覧を`id<TAB>name<TAB>command`形式で表示する。`new-tab --shell`に指定する`id`はここで確認する。プロファイルはniwaterm.config.tsの`shell.profiles`（詳細: `docs/guide/config.md`「シェル設定」節）と、Windows環境では起動時に自動検出したWSLディストロ・PowerShellから構成される。1件も無い場合はその旨を表示する。

```sh
niwaterm capture-tab --tab <tabId>
```

指定したタブの現在の画面内容をプレーンテキストで標準出力へ表示する（tmuxの`capture-pane -p`相当）。エスケープシーケンス・色情報は含まれず、現在画面（viewport）の内容のみが対象でスクロールバックは含まれない。指定したtabIdが存在しない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm set-var --tile <tileId> <key> <value>
niwaterm get-var --tile <tileId> <key>
niwaterm list-vars --tile <tileId>
```

タイルごとのkey-value変数を設定・取得・一覧する（tmuxのペイン変数、`set-option -p`/`show-options -p`相当）。値は文字列固定、キーは`^[A-Za-z0-9_.-]{1,128}$`（英数字・`_`・`-`・`.`のみ、1〜128文字）のみ許可する。**変数は永続化されず、アプリを終了する・対象タイルを閉じると消える**（tileId自体がアプリ再起動のたびに再採番されるため）。`tileId`を指定すればどのタイルからでも別タイルの変数を読み書きできるため、送信元タイルが自身の状態を`set-var`で書き、別タイルがその値を`get-var`で参照しつつ`send-keys`で操作する、といったタイル間の自動化に使える。指定した`tileId`が存在しない場合、または`get-var`で指定した`key`が未設定の場合はエラーメッセージと共に終了コード1を返す。

`--tile`は省略可能で、その場合`NIWATERM_TILE_ID`環境変数を使う。niwaterm内で起動したシェルにはこの環境変数が自動設定されているため、そのタイル自身の変数を読み書きする分にはタイルIDを調べる必要がない（別タイルの変数を操作する場合は`--tile`を明示する）。シェル統合スクリプト（下記「シェル統合」参照）はこれを利用してブランチ名等を`set-var`する。`--tile`省略かつ`NIWATERM_TILE_ID`も無い（niwaterm外のシェルから実行した等）場合はエラーメッセージと共に終了コード1を返す。

## シェル統合

`contrib/shell-integration/`配下のスクリプトをシェルの起動時にsourceすると、プロンプト表示のたびに現在のgitブランチをタイル変数`branch`へ自動反映する（`niwaterm set-var branch <branch>`相当を内部で呼ぶ）。サイドバーのタブ行にブランチ名が表示されるようになる。zsh/bash/fish/PowerShellに対応している。

```sh
# ~/.zshrc
[ -n "$NIWATERM_TILE_ID" ] && source /path/to/niwaterm/contrib/shell-integration/niwaterm.zsh
```

```sh
# ~/.bashrc
[ -n "$NIWATERM_TILE_ID" ] && source /path/to/niwaterm/contrib/shell-integration/niwaterm.bash
```

```fish
# ~/.config/fish/config.fish
test -n "$NIWATERM_TILE_ID"; and source /path/to/niwaterm/contrib/shell-integration/niwaterm.fish
```

```powershell
# $PROFILE
if ($env:NIWATERM_TILE_ID) { . C:\path\to\niwaterm\contrib\shell-integration\niwaterm.ps1 }
```

`NIWATERM_TILE_ID`が無いシェル（niwaterm外のターミナル）では何もしない。PowerShell版は`prompt`関数を上書きするが、既存の`prompt`関数（他ツールのプロンプトカスタマイズ等）を保持して末尾で呼び直すため、他のプロンプト拡張と共存できる。

## エージェント統合

`contrib/agent-integration/`配下の設定を導入すると、タイル内で動くAIエージェント（Claude Code等）のhooks機構から、そのセッションの状態（idle/working/blocked）をタイル変数`agent`/`agent_status`へ自動反映する（`niwaterm set-var agent_status working`相当を内部で呼ぶ）。サイドバーのタブ行に状態ドットが表示されるようになる。

```sh
# ~/.claude/settings.json（グローバル、全プロジェクト共通で使えるので推奨）の"hooks"キーへ
# contrib/agent-integration/claude-code/hooks.jsonの中身をマージする
cp ~/.claude/settings.json ~/.claude/settings.json.bak
jq -s '.[0] * {hooks: (.[0].hooks * .[1].hooks)}' \
  ~/.claude/settings.json /path/to/niwaterm/contrib/agent-integration/claude-code/hooks.json \
  > /tmp/merged-settings.json
mv /tmp/merged-settings.json ~/.claude/settings.json
```

`branch`と同様、`agent`/`agent_status`もタイル変数の予約キーである（値は`niwaterm set-var`で自由に読み書きできる汎用キーだが、この2つの名前はサイドバー表示用に予約されている）。`agent`はエージェントの種別を表す任意の文字列（Claude Codeは`claude-code`固定）、`agent_status`は`idle`/`working`/`blocked`のいずれか（未設定・未知の値は`idle`扱い）。各hookコマンドは`$NIWATERM_TILE_ID`が無い環境（niwaterm外のプロジェクト・ターミナル）では何もしないガードが入っているため、グローバル設定に追加しても安全（詳細: `contrib/agent-integration/README.md`）。Claude Code以外のエージェントを対応させる場合の規約も同READMEに記載している。

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

## IPCサーバーの仕組み

- ソケットパス: `~/Library/Application Support/niwaterm/niwaterm.sock`（固定）
- 通信: `Bun.serve({unix, fetch})` + Hono
  - `GET /ping` — `{ok: true, pid: <number>}`を返す
  - `GET /list` — `{workspaces: WorkspaceListEntry[]}`を返す（各entryは`workspaceId`/`active`/`focusedTileId`/`layout`）
  - `POST /send-keys` — `{tabId: string, keys: string[]}`を受け取り、tmux風キー名をバイト列に変換してPTYへ書き込む（変換テーブルは`src/bun/tmux-keys.ts`、サーバー側に一元化）。tabId不存在時は404、不正なボディは400を返す
  - `POST /split-tile` — `{tileId: string, orientation: "horizontal"|"vertical"}`を受け取り、タイルを分割する。成功時`{ok: true, tileId, tabId}`（新規作成分）を返す。tileId不存在時は404、不正なボディは400
  - `POST /new-tab` — `{tileId: string, url?: string, customView?: boolean, shellProfileId?: string}`を受け取り、新規タブを作成する。`url`指定時はそのURLのブラウザタブ、`customView: true`指定時は設定済みの`customView`を開くブラウザタブ、`shellProfileId`指定時はそのプロファイルのシェルでターミナルタブ、いずれも省略時はデフォルトシェルのターミナルタブ。成功時`{ok: true, tabId}`を返す。tileId不存在時は404、urlが空文字列・3つのうち2つ以上の同時指定・customView未設定時のcustomView:true・未知のshellProfileIdはいずれも400
  - `GET /shell-profiles` — 利用可能なシェルプロファイル一覧を`{ok: true, profiles: {id, name, command}[]}`として返す
  - `POST /switch-tab` — `{tileId: string, tabId: string}`を受け取り、アクティブタブを切り替える。tileId/tabId不存在時は404
  - `POST /close-tab` — `{tileId: string, tabId: string}`を受け取り、タブを閉じる。tileId/tabId不存在、または最後の1枚のタイルの最後のタブの場合は404
  - `POST /focus-tile` — `{tileId: string}`を受け取り、フォーカスを移す。tileId不存在時は404
  - `GET /capture-tab` — `?tabId=<tabId>`を受け取り、そのタブの現在画面をプレーンテキスト（`GhosttyFormatterFormat`の`PLAIN`）で`{ok: true, text}`として返す。tabId未指定は400、tabId不存在は404
  - `POST /set-var` — `{tileId: string, key: string, value: string}`を受け取り、タイル変数を設定する。keyは`^[A-Za-z0-9_.-]{1,128}$`のみ許可、不一致・valueが非stringは400。tileId不存在時は404
  - `GET /get-var` — `?tileId=<tileId>&key=<key>`を受け取り、タイル変数を`{ok: true, value}`として返す。クエリ未指定は400、tileId不存在または未設定のkeyは404
  - `GET /list-vars` — `?tileId=<tileId>`を受け取り、そのタイルの変数を`{ok: true, vars: Record<string,string>}`として返す。tileId未指定は400、tileId不存在は404
  - `POST /browser-navigate` — `{tabId: string, url: string}`を受け取り、ブラウザタブのURLを遷移する。成功時`{ok: true}`。tabId不存在またはterminalタブは404、対象ワークスペースが非アクティブ・ページ未ロード・遷移タイムアウトは409、不正なボディは400
  - `GET /browser-get-text` — `?tabId=<tabId>`を受け取り、ブラウザタブの表示内容を`{ok: true, text}`として返す。404/409/400の条件は`/browser-navigate`と同様
  - `GET /browser-get-html` — `?tabId=<tabId>`を受け取り、ブラウザタブのHTMLを`{ok: true, html}`として返す。404/409/400の条件は`/browser-navigate`と同様
  - `GET /browser-screenshot` — `?tabId=<tabId>`を受け取り、対象タブの現在URLをheadlessな`Bun.WebView`で別途開き直してスクリーンショットを撮り、`image/png`のバイナリを返す。404/409/400の条件は`/browser-navigate`と同様（URL取得失敗・スクショ取得失敗もいずれも409）
  - `POST /show-tab` — `{tabId: string}`を受け取り、所属ワークスペースへの切替・タイルフォーカス・タブアクティブ化・ウィンドウ前面化をまとめて行う。成功時`{ok: true, workspaceId, tileId}`。tabId不存在時は404。対象ワークスペースが非アクティブであること自体は正常系（それを直すのがこのコマンドの役割）なので409にはしない
  - ブラウザタブ操作（`/browser-navigate`・`/browser-get-text`・`/browser-get-html`）は、bunメインプロセスとniwaterm自身のUI（mainview）間のRPC request/response往復、およびmainviewとブラウザタブ（OOPIF）間のJS実行＋`host-message`イベントによる結果返送、という2段階の非同期処理を経由する
- アプリ起動時、同じソケットで別のniwatermプロセスが既に生きている（多重起動）場合はIPCサーバーの起動だけをスキップし、警告ログを出してGUI本体は通常通り起動する（fail-open）
- 前回のアプリがクラッシュ等でソケットファイルを残したまま終了した場合（stale socket）、起動時に生死判定をして自動的に古いファイルを削除してから再listenする

## AIエージェント向けの導線

- `packages/cli/README.md` — CLIパッケージのセットアップ手順・基本的な使い方
- `.claude/skills/niwaterm-cli/SKILL.md` — Claude Codeなどのエージェントがniwatermを操作する際に自律的に発見できるスキル定義

いずれもコマンドの詳細はこのドキュメント（`niwaterm docs show cli`）への導線に留め、内容を書き写さない。

## スコープ外（roadmap参照）

- npm registryへの公開・実行可能ファイルとしての配布
