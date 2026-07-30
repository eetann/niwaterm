# CLIからの操作

niwatermアプリはunix socket経由のIPCサーバーを持ち、`niwaterm`コマンド（CLI）から操作できる。現状は疎通確認（`niwaterm ping`）のみ対応。タイル・タブ・ワークスペースの一覧取得やキー送信などはroadmap「CLIからの操作」参照（未実装）。

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
niwaterm --help
niwaterm ping --help
```

## IPCサーバーの仕組み

- ソケットパス: `~/Library/Application Support/niwaterm/niwaterm.sock`（固定）
- 通信: `Bun.serve({unix, fetch})` + Hono。`GET /ping`が`{ok: true, pid: <number>}`を返す
- アプリ起動時、同じソケットで別のniwatermプロセスが既に生きている（多重起動）場合はIPCサーバーの起動だけをスキップし、警告ログを出してGUI本体は通常通り起動する（fail-open）
- 前回のアプリがクラッシュ等でソケットファイルを残したまま終了した場合（stale socket）、起動時に生死判定をして自動的に古いファイルを削除してから再listenする

## スコープ外（roadmap参照）

- 特定タブへのキー送信（tmux `send-keys`相当）
- タイル・タブ・ワークスペースの一覧取得
- CLIからのレイアウト操作（タイル分割・タブ作成等）
- 特定タブの画面内容（テキスト）取得
- npm registryへの公開・実行可能ファイルとしての配布
