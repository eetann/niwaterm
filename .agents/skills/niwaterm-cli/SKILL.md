---
name: niwaterm-cli
description: |
  niwatermターミナルアプリをniwaterm CLI経由で操作する（OSウィンドウの作成・一覧、ワークスペース/タイル/タブの一覧確認、タブへのキー送信、タイル分割・タブ作成などのレイアウト操作、ワークスペースの作成・切替・削除・名前変更、タブごとの変数、ブラウザタブのURL遷移・内容取得・スクリーンショット、目視確認用のタブ表示、OSデスクトップ通知の送信、gitワークツリーの一覧・作成・削除）。
  トリガー: "niwaterm", "niwa", "niwatermを操作", "niwaterm CLI", "タイルを分割して", "タブにキー送信", "niwatermのブラウザタブを操作", "niwatermで確認したい"
user-invocable: true
allowed-tools: Bash(niwa:*), Bash(niwa-dev:*)
---

# niwaterm CLI

niwatermアプリ（ターミナル・マルチプレクサ・ワークスペース統合デスクトップアプリ）を`niwa` CLI経由で操作するためのスキル。

## 前提確認

- **どのコマンドを使うかはワークツリーで決まる**。`main`（daily側）なら`niwa`、それ以外のワークツリー（devなど、開発中ビルドniwaterm-wip向け）なら`niwa-dev`。`niwa`はdaily側のソースを指すため、devブランチでCLIを直しても`niwa`には反映されない。
- `niwa --version`（または`niwa-dev --version`）でコマンドが使えるか確認する。使えない場合は対象ワークツリーのルートで`mise run cli:link`を実行する。
- niwatermアプリ本体が起動している必要がある。`niwa ping` で疎通確認し、pongが返らなければ`mise run start`でアプリを起動する（バックグラウンド起動を推奨）。ただし`init`・`agent setup`・`worktree list`・`worktree new --open none`はアプリへ接続しないため、起動していなくても使える（`worktree remove`もアプリ無しで削除まで進み、Boardを閉じられない旨の警告だけ出す）。

## できること（概要）

コマンドは操作対象のリソース単位でグループ化されている（`niwaterm <resource> <verb>`。例外: `list`/`ping`/`init`/`notify`/`complete`はリソース単体に属さないためトップレベル）。

**`--tile`/`--tab`/`--board`/`--workspace`は多くのコマンドで省略でき、省略するとそのコマンドを実行しているタブが対象になる**（niwatermの外から実行した場合はフォーカス中タイル・アクティブタブへフォールバック）。省略できないコマンド（`tab send-keys`・各`switch`・`browser *`等）と細かい規則は`niwa docs show cli`の「対象IDの省略」節を参照。

- `agent setup <codex-cli|claude-code>` — AIエージェントのhooksを追加・更新する（アプリの起動は不要）。詳細は`niwa docs show agents`の「エージェント統合」を参照。`_hook`はhooks専用の内部コマンドで、通常の操作では使わない
- `claude prompt list` / `show` — そのタブで動いているClaude Codeのtranscript（jsonl）から、打ったプロンプトの一覧と、選んだプロンプトからのやりとりを読む。**Claude Codeはalternate screenで動くので`tab capture`では会話が取れない**（画面に出ている分すら読めない）代わりの手段で、コンテキスト圧縮で消えたやりとりも辿れる。エージェント統合のhooksが要る（未導入なら`--transcript <path>`で直接指定）。オプションは`niwa claude prompt list --help`・`show --help`を参照
- `init` — 設定ディレクトリ(`~/.config/niwaterm/`、`NIWATERM_CONFIG_DIR`で変更可)の初期セットアップ（`package.json`/`tsconfig.json`/`niwaterm.config.ts`生成 + `bun install`）
- `list` — ワークスペース・Board・タイル・タブの一覧（操作対象のIDを確認する起点。Boardが1つのみのワークスペースはBoard行を省略）。**実行しているタブが載っているOSウィンドウのぶんだけ**表示される。`--json`でタブの種類・cwd・URL・タブ変数まで含むJSONになる（パースするならこちら。形は`niwa docs show cli/commands`）
- `tab new` / `switch` / `close` / `restart` / `focus` / `capture` / `send-keys` — タブ操作（作成・切替・削除・プロセス再起動・目視確認用アクティブ化・画面内容取得・キー送信）
- `tab hover list` / `reveal` / `hide` — タブの端に出るホバーボタン（設定の`hoverButtons`）の確認と強制表示。ホバーは合成入力では当てにくいので、実機での目視・スクリーンショット確認は`reveal`を使う
- `tab var get` / `set` / `list` / `find` — タブごとのkey-value変数（タブ間の連携に使える。`find`は`key=value`が一致するタブを1つのBoard内（既定は`NIWATERM_TAB_ID`のタブが属するBoard、`--board`で明示可）から検索する）
- `window new` / `list` / `close` — OSウィンドウの作成・一覧・クローズ。`window new`で開くのは**一時ウィンドウ**（まっさらな状態で開き、閉じても何も残らず次回起動時にも復元されない）。前回の状態を復元するメインウィンドウは起動時の1枚だけ。ウィンドウをまたいだタブ・Boardの移動はできない
- `workspace new` / `switch` / `close` / `rename` / `move` — ワークスペースの作成・切替・削除・名前変更・表示順の並び替え（`move`は`--up`/`--down`で1つずつ移動）
- `board new` / `switch` / `close` / `rename` / `move` / `startup layout|restore|clear` — Board（1ワークスペース内の複数Tileレイアウト、tmuxのWindow相当）の作成（`new --name <name>`で名前も付けられる）・切替・削除・名前変更・表示順の並び替え・別ワークスペースへの移動（`move`は`--up`/`--down`でワークスペース内を1つずつ移動、`--to-workspace <workspaceId>`で別ワークスペースの末尾へ移動）・起動時レイアウト設定
- `board phase set <phase>` / `clear` / `show` — そのBoardの作業フェーズ（サイドバーのバッジ）の設定・解除・表示。値は設定の`board.phases`のidか任意の文字列。`--board`省略時は実行したタブのBoardが対象なので、エージェントのhookから「今どの段階か」を出せる
- `board worktree set <path>` / `clear` / `show` — そのBoardに紐づくワークツリーの設定・解除・表示。`worktree new`/`open`で開いたBoardには自動で付いており、`worktree open`の「既に開いているBoardか」の判定キーになる。紐づけ先が消えるとサイドバーに警告アイコンが出る。設定の`board.newTabCwd: "worktree"`と組み合わせると新しいタブがここで開く
- `tile split` / `focus` / `resize` / `zoom` — タイルの分割・フォーカス移動・リサイズ・一時的なズーム表示切替（`focus`は`--tile`直接指定と`--direction`隣接移動のどちらか一方、`resize`はtmuxの`resize-pane`相当、`zoom`はtmuxの`resize-pane -Z`相当のトグル）
- `popup open` / `close` / `toggle` / `promote` — タイル・タブに所属しない一時的なポップアップ画面（tmuxのpopup/floating相当。`open`は`--cwd`/`--width`/`--height`指定可、コマンド指定でワンショット実行）
- `browser navigate` / `get-text` / `get-html` / `screenshot` — ブラウザタブ操作
- `sidebar switch --view <viewId>` — サイドバーに出すビューの切替（ワークスペース一覧の`workspaces`、または設定の`customViews`のid。idは`config show`で確認）
- `status-bar refresh [--item <id>]` / `status-bar toggle [--visible on|off]` — ステータスバーの部品の評価し直し・表示切り替え（全ウィンドウ共通。部品のidは`config show`で確認）
- `layout list` / `apply <name>` — niwaterm.config.tsまたはプロジェクトローカルの`.niwaterm/config.ts`で定義したレイアウトプリセットの一覧・適用(vde-layoutライク)。`--replace`は既存タブ・PTYを無条件でcloseするためy/n確認プロンプトが挟まる（非TTY実行だとエラーで終了する）。AIエージェントから確認なしで実行したい場合は`--replace-force`を使う。`--startup`を付けるとそのBoardが次回起動時も同じプリセットで組み直される（`board startup`で後から切替・解除可）
  - ビルトインの`empty`は設定不要で使える。`layout apply empty --replace`でBoardをタイル1つ・タブ1つへ畳み、残る1タブもシェルを起動し直す（動いていたプロセスは全部止まる。引き継ぐのは作業ディレクトリだけ）。同名を設定に定義すればそちらが優先される
  - プロジェクトローカルのプリセットは実行したディレクトリから上向きに`.niwaterm/`を探して解決され、同名ならグローバル設定より優先される（`layout list`の解決元列で確認できる）。**プロジェクトローカル由来のプリセットを`--startup`で紐づけるときだけy/n確認プロンプトが挟まる**（起動のたびにそのリポジトリのcommandが自動実行されるため）。非TTYではエラーになるので、確認なしで実行するには`--trust`を付ける。詳細は`niwa docs show layouts/project-local`
- `worktree list` / `new` / `open` / `remove` — gitワークツリーの一覧・作成・表示・削除。`list`は`path`／`branch`／`HEAD`／フラグのTSVで、先頭行は必ずメインワークツリー（アプリへ接続せず直接gitを呼ぶ）。`new <branch>`はワークツリーを作ってniwatermのBoardとして開き（`--open`は`board`が既定＝Boardを作るが遷移しない。`board-switch`／`current-tab`／`none`も選べる）、`open <worktree>`は既にあるものをブランチ名・パス・ディレクトリ名のいずれかで開く（既定は`board-switch`）。**同じワークツリーのBoardが既に開いていればそれを使い回す**ため、同じコマンドを何度叩いてもBoardが増えず、「あれば使う、無ければ作る」を分岐なしで書ける。`--name`でBoard名、`--layout`でレイアウトプリセットも指定できる（`--layout`で適用したプリセットはそのBoardの起動時レイアウトとしても紐づく）
  - `new <branch>`のブランチはローカル → リモート → 新規作成の順に探す。`origin/feat/x`のようにリモート名を付ければリモートからの作成を明示でき、`--track auto|remote|local|new`で固定もできる（リモートが複数あるなら`--remote`）。作る前に`git fetch`が1回走る（`--no-fetch`で抑止）
  - `remove <worktree>`はワークツリーをディレクトリごと削除し、そのBoardも閉じる（`--keep-board`で残せる）。**未コミットの変更・未pushのコミット・ロックがあると何も消さずに終了コード1で止まる**ので、意図して消すなら`--force`を付ける。ブランチは既定で残り、`--delete-branch`で消せる（未マージなら`--force`も要る）。削除の直前・直後に`worktree.onBeforeRemove`・`worktree.onRemove`フックが走る
  - **プロジェクトローカル設定（`<repoRoot>/.niwaterm/config.ts`）を持つリポジトリでは初回にy/n確認が挟まるので、非対話で叩くなら`--trust`を付ける**（付けないとその設定を無視して続行し、`--layout`を指定していれば終了コード1で止まる）。置き場所・Boardとの紐づけは`niwa docs show worktrees`、作成後フック・承認は`niwa docs show worktrees/hooks`
- `keybind list` — 現在有効なキーバインドの一覧（tmuxの`list-keys`相当。prefix経由のバインドと即時発火のdirectを分けて表示。設定が反映されているかの確認に使う）
- `config show` — 現在有効な設定値の一覧（設定ファイルのトップレベルキーごとに、マージ後の実際に効いている値。ズーム中のフォントサイズもここで分かる。関数で書く設定・キーバインドの個々の割り当ては含まない）。設定が効かないときは一覧より前に出る`[読み込みエラー]`・`[無視した設定]`を見る
- `shell-profile list` — 利用可能なシェルプロファイルの一覧（`tab new --shell`・`tab restart --shell`・レイアウトプリセットの`shellProfile`に指定するidをここで確認する）
- `font-size increase|decrease|reset` — フォントサイズの拡大・縮小・リセット（configファイルは変更しない実行時ズーム）
- `notify --title <title> [--body] [--subtitle] [--silent] [--tab]` — OSのデスクトップ通知を出す（タスク完了等をユーザーへ知らせる用途。macOSではクリックで通知元タブへ遷移する）
- `complete <bash|zsh|fish|powershell>` — シェルの補完スクリプトを出力する。コマンド名・オプション名に加えてtabId・レイアウトプリセット名などの値も補完される。設置手順は`niwa docs show shell-integration`の「シェル補完」節

## 詳しい使い方

コマンドの全オプション・使用例・終了コード・設定ファイルの書き方は`niwa docs show <topic>`で確認すること。このSKILL.mdには詳細を書き写さない（常に最新の内容を得るため、都度このコマンドを呼ぶ）。

    niwa docs show cli              # 全コマンドの一覧と、説明のあるページ
    niwa docs show cli/commands     # 基本のコマンドの分かりにくい挙動（オプションは各コマンドの--help）
    niwa docs show getting-started  # CLIのリンク・設定ディレクトリの作成・設定値の確認
    niwa docs show concepts         # Window・Workspace・Board・Tile・Tabの階層と役割
    niwa docs show keybindings      # キーバインドの書き方（niwa APIの一覧はkeybindings/api）
    niwa docs show layouts          # レイアウトプリセットの定義と適用
    niwa docs show resume           # 起動時にコマンドを再実行（設定・board resume）
    niwa docs show worktrees        # ワークツリー管理（置き場所・Boardとの紐づけ）
    niwa docs show agents           # エージェント統合

トピック一覧の確認は`niwa docs list`（`--json`でパース向けの出力）、個別コマンドのオプション確認は`niwaterm <command> --help`でも可能。トピックはドキュメントサイトのページ（`website/src/content/docs/`）から自動で列挙されるので、ここに挙げた以外が増えていることもある。サブディレクトリ内のページは`keybindings/api`のように`/`区切りのトピック名になる。ドキュメントは機能ごとのページに分かれていて、その機能の設定とCLIコマンドは同じページにある。どのページか分からなければ、まず`docs list`で説明を見て選ぶ。

## 典型的な流れ

1. `niwa ping` で疎通確認
2. `niwa list` で操作対象のtileId/tabIdを確認
3. 目的のサブコマンドを実行。分からない場合は`niwa docs show cli`を参照
