---
name: niwaterm-cli
description: |
  niwatermターミナルアプリをniwaterm CLI経由で操作する（ワークスペース/タイル/タブの一覧確認、タブへのキー送信、タイル分割・タブ作成などのレイアウト操作、ワークスペースの作成・切替・削除・名前変更、タブごとの変数、ブラウザタブのURL遷移・内容取得・スクリーンショット、目視確認用のタブ表示）。
  トリガー: "niwaterm", "niwatermを操作", "niwaterm CLI", "タイルを分割して", "タブにキー送信", "niwatermのブラウザタブを操作", "niwatermで確認したい"
user-invocable: true
allowed-tools: Bash(niwaterm:*)
---

# niwaterm CLI

niwatermアプリ（ターミナル・マルチプレクサ・ワークスペース統合デスクトップアプリ）を`niwaterm` CLI経由で操作するためのスキル。

## 前提確認

- `niwaterm --version` でコマンドが使えるか確認する。使えない場合は`packages/cli/README.md`の手順（`cd packages/cli && bun link`）でセットアップする。
- niwatermアプリ本体が起動している必要がある。`niwaterm ping` で疎通確認し、pongが返らなければ`bun run start`でアプリを起動する（バックグラウンド起動を推奨）。

## できること（概要）

- `list` — ワークスペース・タイル・タブの一覧（操作対象のIDを確認する起点）
- `send-keys` — 指定タブへのキー送信（tmuxのsend-keys相当）
- `split-tile` / `new-tab` / `switch-tab` / `close-tab` / `focus-tile` / `focus-direction` — レイアウト操作
- `popup` — タイル・タブに所属しない一時的なポップアップ画面を開く（tmuxのpopup/floating相当。`--cwd`/`--width`/`--height`指定可、コマンド指定でワンショット実行）
- `new-workspace` / `switch-workspace` / `close-workspace` / `rename-workspace` — ワークスペースの作成・切替・削除・名前変更
- `layout list` / `layout apply <name>` — niwaterm.config.tsで定義したレイアウトプリセットの一覧・適用（vde-layoutライク）
- `capture-tab` — タブの画面内容（プレーンテキスト）取得
- `set-var` / `get-var` / `list-vars` — タブごとのkey-value変数（タブ間の連携に使える）
- `browser-navigate` / `browser-get-text` / `browser-get-html` / `browser-screenshot` — ブラウザタブ操作
- `show-tab` — 人間が目視確認できるようウィンドウを前面化する

## 詳しい使い方

コマンドの全オプション・使用例・終了コード・IPCサーバー仕様は次のコマンドで確認すること。このSKILL.mdには詳細を書き写さない（常に最新の内容を得るため、都度このコマンドを呼ぶ）。

    niwaterm docs show cli

トピック一覧の確認は`niwaterm docs list`、個別コマンドのオプション確認は`niwaterm <command> --help`でも可能。

## 典型的な流れ

1. `niwaterm ping` で疎通確認
2. `niwaterm list` で操作対象のtileId/tabIdを確認
3. 目的のサブコマンドを実行。分からない場合は`niwaterm docs show cli`を参照
