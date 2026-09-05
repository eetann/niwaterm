---
name: niwaterm-cli
description: |
  niwatermターミナルアプリをniwaterm CLI経由で操作する（ワークスペース/タイル/タブの一覧確認、タブへのキー送信、タイル分割・タブ作成などのレイアウト操作、ワークスペースの作成・切替・削除・名前変更、タブごとの変数、ブラウザタブのURL遷移・内容取得・スクリーンショット、目視確認用のタブ表示、OSデスクトップ通知の送信）。
  トリガー: "niwaterm", "niwatermを操作", "niwaterm CLI", "タイルを分割して", "タブにキー送信", "niwatermのブラウザタブを操作", "niwatermで確認したい"
user-invocable: true
allowed-tools: Bash(niwaterm:*), Bash(niwaterm-dev:*)
---

# niwaterm CLI

niwatermアプリ（ターミナル・マルチプレクサ・ワークスペース統合デスクトップアプリ）を`niwaterm` CLI経由で操作するためのスキル。

## 前提確認

- **どのコマンドを使うかはワークツリーで決まる**。`main`（daily側）なら`niwaterm`、それ以外のワークツリー（devなど、開発中ビルドniwaterm-wip向け）なら`niwaterm-dev`。`niwaterm`はdaily側のソースを指すため、devブランチでCLIを直しても`niwaterm`には反映されない。
- `niwaterm --version`（または`niwaterm-dev --version`）でコマンドが使えるか確認する。使えない場合は対象ワークツリーのルートで`mise run cli:link`を実行する。
- niwatermアプリ本体が起動している必要がある。`niwaterm ping` で疎通確認し、pongが返らなければ`mise run start`でアプリを起動する（バックグラウンド起動を推奨）。

## できること（概要）

コマンドは操作対象のリソース単位でグループ化されている（`niwaterm <resource> <verb>`。例外: `list`/`ping`/`init`/`layout`/`font-size`/`shell-profiles`/`notify`/`docs`はリソース単体に属さないためトップレベル）。

**`--tile`/`--tab`/`--board`/`--workspace`は多くのコマンドで省略でき、省略するとそのコマンドを実行しているタブが対象になる**（niwatermの外から実行した場合はフォーカス中タイル・アクティブタブへフォールバック）。省略できないコマンド（`tab send-keys`・各`switch`・`browser *`等）と細かい規則は`niwaterm docs show cli`の「対象IDの省略」節を参照。

- `init` — 設定ディレクトリ(`~/.config/niwaterm/`)の初期セットアップ（`package.json`/`tsconfig.json`/`niwaterm.config.ts`生成 + `bun install`）
- `list` — ワークスペース・Board・タイル・タブの一覧（操作対象のIDを確認する起点。Boardが1つのみのワークスペースはBoard行を省略）
- `tab new` / `switch` / `close` / `respawn` / `show` / `capture` / `send-keys` — タブ操作（作成・切替・削除・プロセス再起動・目視確認用アクティブ化・画面内容取得・キー送信）
- `tab var get` / `set` / `list` / `find` — タブごとのkey-value変数（タブ間の連携に使える。`find`は`key=value`が一致するタブを1つのBoard内（既定は`NIWATERM_TAB_ID`のタブが属するBoard、`--board`で明示可）から検索する）
- `workspace new` / `switch` / `close` / `rename` / `move` — ワークスペースの作成・切替・削除・名前変更・表示順の並び替え（`move`は`--up`/`--down`で1つずつ移動）
- `board new` / `switch` / `close` / `rename` / `move` / `startup` — Board（1ワークスペース内の複数Tileレイアウト、tmuxのWindow相当）の作成・切替・削除・名前変更・表示順の並び替え（`move`は`--up`/`--down`でワークスペース内を1つずつ移動）・起動時レイアウト設定
- `tile split` / `focus` / `resize` / `zoom` — タイルの分割・フォーカス移動・リサイズ・一時的なズーム表示切替（`focus`は`--tile`直接指定と`--direction`隣接移動のどちらか一方、`resize`はtmuxの`resize-pane`相当、`zoom`はtmuxの`resize-pane -Z`相当のトグル）
- `popup open` / `close` / `toggle` / `promote` — タイル・タブに所属しない一時的なポップアップ画面（tmuxのpopup/floating相当。`open`は`--cwd`/`--width`/`--height`指定可、コマンド指定でワンショット実行）
- `browser navigate` / `get-text` / `get-html` / `screenshot` — ブラウザタブ操作
- `layout list` / `apply <name>` — niwaterm.config.tsまたはプロジェクトローカルの`.niwaterm/config.ts`で定義したレイアウトプリセットの一覧・適用(vde-layoutライク)。`--replace`は既存タブ・PTYを無条件でcloseするためy/n確認プロンプトが挟まる（非TTY実行だとエラーで終了する）。AIエージェントから確認なしで実行したい場合は`--replace-force`を使う。`--startup`を付けるとそのBoardが次回起動時も同じプリセットで組み直される（`board startup`で後から切替・解除可）
  - プロジェクトローカルのプリセットは実行したディレクトリから上向きに`.niwaterm/`を探して解決され、同名ならグローバル設定より優先される（`layout list`の解決元列で確認できる）。**プロジェクトローカル由来のプリセットを`--startup`で紐づけるときだけy/n確認プロンプトが挟まる**（起動のたびにそのリポジトリのcommandが自動実行されるため）。非TTYではエラーになるので、確認なしで実行するには`--trust`を付ける。詳細は`niwaterm docs show cli`の「プロジェクトローカルのレイアウト」節
- `keybind list` — 現在有効なキーバインドの一覧（tmuxの`list-keys`相当。prefix経由のバインドと即時発火のdirectを分けて表示。設定が反映されているかの確認に使う）
- `font-size increase|decrease|reset` — フォントサイズの拡大・縮小・リセット（configファイルは変更しない実行時ズーム）
- `notify --title <title> [--body] [--subtitle] [--silent]` — OSのデスクトップ通知を出す（タスク完了等をユーザーへ知らせる用途。クリックしてもniwatermへのフォーカス移動は行わない）

## 詳しい使い方

コマンドの全オプション・使用例・終了コード・IPCサーバー仕様は次のコマンドで確認すること。このSKILL.mdには詳細を書き写さない（常に最新の内容を得るため、都度このコマンドを呼ぶ）。

    niwaterm docs show cli

トピック一覧の確認は`niwaterm docs list`、個別コマンドのオプション確認は`niwaterm <command> --help`でも可能。

## 典型的な流れ

1. `niwaterm ping` で疎通確認
2. `niwaterm list` で操作対象のtileId/tabIdを確認
3. 目的のサブコマンドを実行。分からない場合は`niwaterm docs show cli`を参照
