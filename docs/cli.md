# CLIからの操作

niwatermアプリはunix socket経由のIPCサーバーを持ち、`niwaterm`コマンド（CLI）から操作できる。疎通確認（`niwaterm ping`）、ワークスペース・タイル・タブの一覧取得（`niwaterm list`）、特定タブへのキー送信（`niwaterm send-keys`）、タイル分割・タブ作成・タブ切替・タブを閉じる・タイルへのフォーカス移動（`niwaterm split-tile`/`new-tab`/`switch-tab`/`close-tab`/`focus-tile`）、特定タブの画面内容取得（`niwaterm capture-tab`）に対応。

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
niwaterm new-tab --tile <tileId>
niwaterm switch-tab --tile <tileId> --tab <tabId>
niwaterm close-tab --tile <tileId> --tab <tabId>
niwaterm focus-tile --tile <tileId>
```

レイアウト操作コマンド。いずれも対象の`tileId`/`tabId`は`niwaterm list`で確認する。

- `split-tile` — 指定タイルを分割する（`--orientation`省略時は`vertical`）。成功時、新規に作られた`tileId`/`tabId`を表示する
- `new-tab` — 指定タイルに新規タブを作成する。成功時、新規`tabId`を表示する
- `switch-tab` — 指定タイル内でアクティブタブを切り替える
- `close-tab` — 指定タブを閉じる（tmuxの`kill-window`相当）。ワークスペース最後の1枚のタイルの最後のタブは誤操作防止のため閉じられない
- `focus-tile` — 指定タイルへフォーカスを移す

いずれも対象の`tileId`/`tabId`が存在しない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm capture-tab --tab <tabId>
```

指定したタブの現在の画面内容をプレーンテキストで標準出力へ表示する（tmuxの`capture-pane -p`相当）。エスケープシーケンス・色情報は含まれず、現在画面（viewport）の内容のみが対象でスクロールバックは含まれない。指定したtabIdが存在しない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm --help
niwaterm ping --help
```

## IPCサーバーの仕組み

- ソケットパス: `~/Library/Application Support/niwaterm/niwaterm.sock`（固定）
- 通信: `Bun.serve({unix, fetch})` + Hono
  - `GET /ping` — `{ok: true, pid: <number>}`を返す
  - `GET /list` — `{workspaces: WorkspaceListEntry[]}`を返す（各entryは`workspaceId`/`active`/`focusedTileId`/`layout`）
  - `POST /send-keys` — `{tabId: string, keys: string[]}`を受け取り、tmux風キー名をバイト列に変換してPTYへ書き込む（変換テーブルは`src/bun/tmux-keys.ts`、サーバー側に一元化）。tabId不存在時は404、不正なボディは400を返す
  - `POST /split-tile` — `{tileId: string, orientation: "horizontal"|"vertical"}`を受け取り、タイルを分割する。成功時`{ok: true, tileId, tabId}`（新規作成分）を返す。tileId不存在時は404、不正なボディは400
  - `POST /new-tab` — `{tileId: string}`を受け取り、新規タブを作成する。成功時`{ok: true, tabId}`を返す。tileId不存在時は404
  - `POST /switch-tab` — `{tileId: string, tabId: string}`を受け取り、アクティブタブを切り替える。tileId/tabId不存在時は404
  - `POST /close-tab` — `{tileId: string, tabId: string}`を受け取り、タブを閉じる。tileId/tabId不存在、または最後の1枚のタイルの最後のタブの場合は404
  - `POST /focus-tile` — `{tileId: string}`を受け取り、フォーカスを移す。tileId不存在時は404
  - `GET /capture-tab` — `?tabId=<tabId>`を受け取り、そのタブの現在画面をプレーンテキスト（`GhosttyFormatterFormat`の`PLAIN`）で`{ok: true, text}`として返す。tabId未指定は400、tabId不存在は404
- アプリ起動時、同じソケットで別のniwatermプロセスが既に生きている（多重起動）場合はIPCサーバーの起動だけをスキップし、警告ログを出してGUI本体は通常通り起動する（fail-open）
- 前回のアプリがクラッシュ等でソケットファイルを残したまま終了した場合（stale socket）、起動時に生死判定をして自動的に古いファイルを削除してから再listenする

## スコープ外（roadmap参照）

- npm registryへの公開・実行可能ファイルとしての配布
