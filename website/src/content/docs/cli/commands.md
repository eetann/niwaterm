---
title: 基本のコマンド
description: ウィンドウ・ワークスペース・Board・タイル・タブ・ポップアップを操作するコマンドと、状態や設定を確かめるコマンド
---

ウィンドウ・ワークスペース・Board・タイル・タブ・ポップアップを操作するコマンドと、状態や設定を確かめるコマンドをまとめる。ほかのコマンドは、そのコマンドが関わる機能のページで説明している（一覧は[CLIからの操作](/niwaterm/cli/)）。

## 状態を確認する（`ping` / `list`）

```sh
niwaterm ping
```

niwatermアプリが起動していれば`pong (pid <アプリのpid>)`が返る（終了コード0）。アプリが起動していない、またはIPCサーバーに接続できない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm list
```

実行しているタブが載っているウィンドウの、ワークスペース→Board→タイル→タブの階層構造を表示する（niwatermの外から実行した場合は最後にフォーカスされたウィンドウ）。ウィンドウをまたいだ俯瞰は`niwaterm window list`を使う。Boardが1つのみのワークスペースはBoard行を省略する（ADR 0006、サイドバー表示と同じ方針）。アクティブなワークスペース/Board/フォーカス中タイル/アクティブタブにはそれぞれ`(active)`/`(active)`/`(focused)`/`(active)`のサフィックスが付く。`tab send-keys`で指定するtabIdはここで確認する。

名前が付いているワークスペース・Board・タブは、idの直後に`"名前"`が入る（Boardは名前未設定でも自動命名の結果を出す）。タブ名はGUIのタブバーからのリネーム（キーバインドの`rename-tab`）、またはレイアウトプリセットの`name`で付く。

```
workspace-1 "dev" (active)
  tile-1 (focused)
    tab-1 "editor" (active)
    tab-2
  tile-2
    tab-3 "server" (active)
```

レイアウトプリセットが紐づいているBoardには`[startup: <name>]`（起動時にそのプリセットで組み直す）または`[preset: <name>]`（プリセット名は覚えているが起動時は骨格を復元する）が付く（[「起動時レイアウト」節](/niwaterm/layouts/#起動時レイアウト)）。この表示を確認できるよう、紐づけのあるBoardはワークスペース内に1つしか無くてもBoard行を省略しない。

## ウィンドウ（`window`）

```sh
niwaterm window new [--cwd <dir>]
niwaterm window list
niwaterm window close --window <windowId>
```

OSウィンドウ単位の操作コマンド。ウィンドウの中身（ワークスペース以下）はウィンドウごとに独立していて、ウィンドウをまたいだタブ・Boardの移動はできない。

- `window new` — 新しいOSウィンドウを開く。成功時、新規`windowId`を表示する。`--cwd`は最初のタブの作業ディレクトリ（省略時はOS標準）
- `window list` — 開いているウィンドウを`windowId (種別[, focused])`形式で表示し、各ウィンドウが持つワークスペースをぶら下げる。種別は`main`（メインウィンドウ）か`temporary`（一時ウィンドウ）。名前が付いているワークスペースは`niwaterm list`と同じく`workspaceId "名前"`形式になる
- `window close` — 指定したウィンドウを閉じる。中のPTYはすべて終了する。最後の1つを閉じるとniwaterm自体が終了する（キーバインドの`close-window`アクション・コマンドパレットの「Close Window」からも同じことができる。そちらは確認ダイアログを挟む）

ウィンドウは2種類ある（ADR 0007）。

- **メインウィンドウ** — 起動時に1枚だけ開く。前回終了時のワークスペース・Board・タイル・タブ（`workspaces.json`）とウィンドウのサイズ・位置を復元し、終了時にも書き戻す
- **一時ウィンドウ** — `window new`・キーバインド（既定は prefix + `shift+w`）・コマンドパレットの「新しいウィンドウを開く」で開く。まっさらな状態で開き、閉じても何も残らない（次回起動時に復元されない）。ブラウザの新規ウィンドウと同じ扱い

`workspaces.json`への書き戻しは原子的に行い、直前の内容を`workspaces.json.bak`として1世代だけ残す。起動時に本体が読めなければこの控えから復元する（このときは直前の変更が落ちている可能性があるため通知で知らせる）。両方とも読めなかった場合はまっさらな状態で起動し、**その起動のあいだは保存を行わない**。読めなかっただけのファイルを空の状態で上書きすると手で戻せなくなるため、保存を止めて通知だけ出す。ファイルを直すか別名へ退避してから起動し直せば、以降は普通に保存される。

`--tile`等を省略したときの対象は「そのコマンドを実行しているタブが載っているウィンドウ」になる（[「対象IDの省略」節](/niwaterm/cli/#対象idの省略)）。

## ワークスペース（`workspace`）

```sh
niwaterm workspace new
niwaterm workspace switch --workspace <workspaceId>
niwaterm workspace close [--workspace <workspaceId>]
niwaterm workspace rename [--workspace <workspaceId>] <name>
niwaterm workspace move [--workspace <workspaceId>] --up | --down
```

ワークスペース単位の操作コマンド。対象の`workspaceId`は`niwaterm list`で確認する。`close`/`rename`/`move`は`--workspace`を省略でき、その場合は実行しているタブが属するワークスペース（niwatermの外から実行した場合はアクティブなワークスペース）が対象になる。

- `workspace new` — 新規ワークスペースを作成し、アクティブにする。成功時、新規`workspaceId`を表示する
- `workspace switch` — 指定したワークスペースへ切り替える
- `workspace close` — 指定したワークスペースを閉じる。最後の1つのワークスペースは誤操作防止のため閉じられない
- `workspace rename` — 指定したワークスペースの名前を変更する（サイドバーの見出しラベルに反映される）。`<name>`に空文字列を指定するとデフォルトの連番ラベル（`Workspace N`）へ戻る。タブ名・タイル名同様、アプリ再起動をまたいでも復元される
- `workspace move` — 表示順（サイドバーの並び・ウィンドウタイトルの番号）を1つ上（`--up`）または1つ下（`--down`）へ移動する。`--up`/`--down`はどちらか一方が必須。中身（Board・タイル・タブ）とアクティブなワークスペースは変わらない。既に端にいて動かせない場合は何もせず成功扱いになる。並び順は名前同様アプリ再起動をまたいでも復元される（離れた位置へまとめて動かしたい場合はサイドバーのドラッグ&ドロップ、または設定ファイルの`niwa.workspace.move(workspaceId, index)`を使う）

いずれも対象の`workspaceId`が存在しない場合、`workspace close`はさらに最後の1つを指定した場合もエラーメッセージと共に終了コード1を返す。

アクティブなワークスペースに対する同じ操作は、キーバインド（`new-workspace`・`rename-workspace`・`close-workspace`アクション）とコマンドパレット、サイドバーの見出しの右クリックからも行える。コマンドパレットには切り替え先ごとに「Switch to Workspace: <名前>」も並ぶ。

## Board（`board`）

```sh
niwaterm board new [--workspace <workspaceId>] [--cwd <dir>] [--name <name>]
niwaterm board switch --board <boardId>
niwaterm board close [--board <boardId>]
niwaterm board rename [--board <boardId>] <name>
niwaterm board move [--board <boardId>] --up | --down | --to-workspace <workspaceId>
niwaterm board phase set <phase> [--board <boardId>]
niwaterm board phase clear [--board <boardId>]
niwaterm board phase show [--board <boardId>]
niwaterm board startup layout|restore|clear [--board <boardId>] [--preset <name>] [--cwd <dir>] [--trust]
niwaterm board worktree set <path> [--board <boardId>]
niwaterm board worktree clear [--board <boardId>]
niwaterm board worktree show [--board <boardId>]
```

Board（1つのワークスペース内で複数持てる独立したTileレイアウト。tmuxのWindow相当、詳細: `docs/adr/0006-adopt-board-layer-between-workspace-and-tile.md`）単位の操作コマンド。対象の`boardId`は`niwaterm list`（複数Board時のみBoard行が表示される）または`board new`実行時に表示される値で確認する。

- `board new` — 新規Boardを作成し、アクティブにする。`--workspace`省略時は現在アクティブなワークスペースに作成する。`--cwd`は最初のタブの作業ディレクトリ（省略時はOS標準）。`--name`はBoardの名前（省略時は設定`board.naming`による自動命名。後から変えるには`board rename`）。成功時、新規`boardId`を表示する
- `board switch` — 指定したBoardへ切り替える
- `board close` — 指定したBoardを閉じる。ワークスペース内最後の1つでも、他にワークスペースがあればBoard 0個の状態で残せる（[「Boardが0個のワークスペース」節](/niwaterm/boards/#boardが0個のワークスペース)を参照）。ワークスペースも1つだけの場合は閉じるとウィンドウごと畳むことになるため、誤操作防止で閉じられない。`--board`省略時は実行しているタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）
- `board rename` — 指定したBoardの名前を変更する。`<name>`に空文字列を指定すると設定`board.naming`による自動命名へ戻る（[「自動命名」節](/niwaterm/boards/#自動命名boardnaming)）。`--board`の省略時の扱いは`board close`と同じ
- `board move` — Boardを動かす。`--up`/`--down`/`--to-workspace`のいずれか1つが必須
  - `--up` / `--down` — 所属ワークスペース内での表示順（サイドバーの並び）を1つ上・1つ下へ移動する。中身（タイル・タブ）とアクティブなBoardは変わらない。既に端にいて動かせない場合は何もせず成功扱いになる。並び順は名前同様アプリ再起動をまたいでも復元される（離れた位置へまとめて動かしたい場合はサイドバーのドラッグ&ドロップ、または設定ファイルの`niwa.board.move(boardId, index)`を使う）
  - `--to-workspace <workspaceId>` — Boardを別のワークスペースへ移す（tmuxの`move-window`相当）。レイアウト・タブ・実行中のプロセスはそのまま移り、移動先ワークスペースの末尾に付く。アクティブなBoardは移動元・移動先とも変わらない。移動元がこれでBoard 0個になっても、そのワークスペースは残る（開いているポップアップだけは閉じる）
- `board phase` — そのBoardの作業フェーズ（サイドバーのBoard行に出るバッジ）を設定・解除・表示する。`set`に渡す`<phase>`は`niwaterm.config.ts`の`board.phases`で定義したid（未定義の任意の文字列も渡せて、その場合は文字列がそのまま既定色のバッジになる）。`show`は現在の値を1行で表示し（未設定なら空行）、`clear`で解除する。`--board`の省略時の扱いは`board close`と同じなので、エージェントのhookからそのタブのBoardへ付けられる。候補の定義とサイドバー・キーバインドからの切り替えは[「Board設定」節](/niwaterm/boards/#board設定)を参照
- `board startup` — そのBoardを次回起動時にどう組み直すかを設定する（`--board`省略時は現在アクティブなBoard）。[「起動時レイアウト」節](/niwaterm/layouts/#起動時レイアウト)を参照
- `board worktree` — そのBoardに紐づくワークツリーを設定・解除・表示する（`--board`省略時の扱いは`board close`と同じ）。[「Boardに紐づくワークツリー」節](/niwaterm/worktrees/#boardに紐づくワークツリー)を参照

いずれも対象の`boardId`（`board new`は`workspaceId`）が存在しない場合、`board close`はさらにワークスペースが1つだけの状態でその最後の1つを指定した場合もエラーメッセージと共に終了コード1を返す。

アクティブなBoardに対する同じ操作は、キーバインド（`new-board`・`close-board`・`rename-board`等のアクション）とコマンドパレット、サイドバーの右クリックからも行える。コマンドパレットには切り替え先ごとに「Switch to Board: <名前>」もワークスペース横断で並ぶ。

## タイルとタブ（`tile` / `tab`）

```sh
niwaterm tile split [--tile <tileId>] [--orientation horizontal|vertical] [--cwd <dir>]
niwaterm tab new [--tile <tileId>] [--url <url> | --custom-view [--view <viewId>] | [--shell <shellProfileId>] [--cwd <dir>]]
niwaterm tab switch [--tile <tileId>] --tab <tabId>
niwaterm tab switch [--tile <tileId>] --direction next|prev
niwaterm tab close [--tile <tileId>] [--tab <tabId>]
niwaterm tab restart [--tab <tabId>] [--shell <shellProfileId>] [--cwd <dir>] [--command <cmd>]
niwaterm tile focus [--tile <tileId>]
niwaterm tile focus --direction up|down|left|right
niwaterm tile resize [--tile <tileId>] --direction up|down|left|right [--amount <0より大きく1以下>]
niwaterm tile zoom [--tile <tileId>]
```

レイアウト操作コマンド。いずれも対象の`tileId`/`tabId`は`niwaterm list`で確認する。`--tile`/`--tab`を省略した場合の対象は[「対象IDの省略」節](/niwaterm/cli/#対象idの省略)を参照。

- `tile split` — 指定タイルを分割する（`--orientation`省略時は`vertical`）。`--cwd`省略時は分割対象タイルのアクティブタブが実際にいるディレクトリ（[「シェル統合」](/niwaterm/shell-integration/#シェル統合)参照。不明ならOS標準）を新規タブの作業ディレクトリに使う。成功時、新規に作られた`tileId`/`tabId`を表示する
- `tab new` — 指定タイルに新規タブを作成する。`--url`指定時はそのURLを開くブラウザタブ、`--custom-view`指定時は`niwaterm.config.ts`の`customViews`設定を開くブラウザタブ（どのビューを開くかは`--view <viewId>`で選ぶ。省略時は設定の先頭。idは`niwaterm config show`で確認）、`--shell`指定時はそのシェルプロファイル（idは`niwaterm shell-profile list`で確認）でターミナルタブ、いずれも省略時はデフォルトシェルの通常のターミナルタブを作成する（`--url`・`--custom-view`・`--shell`は互いに同時指定不可）。`--cwd`で作業ディレクトリを指定できる（ターミナルタブ専用。`--shell`とは併用可、`--url`・`--custom-view`とは同時指定不可）。`--cwd`省略時は`tile split`と同様、対象タイルのアクティブタブが実際にいるディレクトリを使う。成功時、新規`tabId`を表示する
- `tab switch` — 指定タイル内でアクティブタブを切り替える。`--tab`（直接指定）と`--direction`（タブ並び順で1つ次/前へ巡回。端では反対側へ回り込む）はどちらか一方のみ指定でき、両方省略するとエラーになる。`--tile`省略時は`--tab`のタブが属するタイル、`--direction`指定時は実行しているタブのタイル。対象タイルのタブが1枚だけの場合は失敗する
- `tab close` — 指定タブを閉じる（tmuxの`kill-window`相当）。ワークスペース最後の1枚のタイルの最後のタブは誤操作防止のため閉じられない。引数を全て省略すると実行しているタブ自身が閉じる
- `tab restart` — 指定タブのプロセスを強制終了し、同じ`tabId`・タイル位置のまま再起動する（tmuxの`respawn-pane -k`相当、対象がブラウザタブの場合は失敗する）。`--shell`省略時はデフォルトシェル、`--cwd`省略時は元のタブが実際にいるディレクトリを引き継ぐ。`--command`を指定すると、シェルの代わりにそのコマンドを実行する（`popup open`の位置引数と同じ意味のワンショット実行）。GUIのキーバインドからこの操作を割り当てた場合は実行前にy/nの確認ダイアログを挟むが、CLIからの実行に確認は無い
- `tile focus` — タイルへフォーカスを移す。`--tile`（直接指定）と`--direction`（現在フォーカス中のタイルから見て指定方向にある最も近いタイルへ移動。該当タイルが無ければ何もしない、エラーにはならない。常にアクティブなワークスペース基準で動く）はどちらか一方のみ指定できる。どちらも省略すると実行しているタブのタイルへフォーカスを移す（背面のタブから自分を前に出す用途）
- `tile resize` — 指定タイルを指定方向へ拡大する（tmuxの`resize-pane`相当）。`--amount`省略時は既定の1ステップ分。`--direction`の軸に一致するsplitが祖先に無い場合（単一タイルのワークスペース等）は失敗する
- `tile zoom` — 指定タイルの一時的なズーム表示を切り替える（tmuxの`resize-pane -Z`相当）。他のタイルを隠して画面全体に表示し、再度実行すると解除する。ズーム中のタイルを分割する、または他のタイルへフォーカスを移すと自動的に解除される

いずれも対象の`tileId`/`tabId`が存在しない場合はエラーメッセージと共に終了コード1を返す。

## キーを送る（`tab send-keys`）

```sh
niwaterm tab send-keys --tab <tabId> <keys...>
```

指定したタブへキーを送信する（tmuxの`send-keys`相当）。`<keys...>`にはリテラル文字列と特殊キー名を複数個並べて混在指定できる。

```sh
niwaterm tab send-keys --tab tab-3 'ls -la' Enter
niwaterm tab send-keys -t tab-3 C-c
```

対応する特殊キー名: `Enter`, `Escape`, `Tab`, `Space`, `BSpace`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `Delete`, `PageUp`, `PageDown`。`C-a`〜`C-z`（英字のみ）でCtrl修飾も送れる。上記以外の文字列はリテラルとしてそのままPTYへ送信される。指定したtabIdが存在しない場合はエラーメッセージと共に終了コード1を返す。

1回の呼び出しで並べたキーは連結して一度に書き込まれるため、この中での順序は保証される。一方で**別々の呼び出しで投げたキーの到着順は保証されない**。呼び出しごとにCLIのプロセス起動とIPC往復の遅延が乗り、その差はキーを送り出した間隔を超えうるため、後から投げたキーが先に届くことがある。順序が要るなら1回の呼び出しにまとめるか、前の呼び出しの終了を待ってから次を投げる。

なお、TUIの中には文字列と直後の`Enter`が1回の読み取りで届くと「改行を含むペースト」と解釈して送信しないものがある（codex等）。この場合は1回にまとめるのではなく、前の呼び出しの終了を待った上で`Enter`だけを別の呼び出しで送る。

## 画面の内容を取る（`tab capture`）

```sh
niwaterm tab capture [--tab <tabId>]
```

指定したタブの現在の画面内容をプレーンテキストで標準出力へ表示する（tmuxの`capture-pane -p`相当）。エスケープシーケンス・色情報は含まれず、現在画面（viewport）の内容のみが対象でスクロールバックは含まれない。`--tab`省略時は実行しているタブ自身の画面を取得する。指定したtabIdが存在しない場合はエラーメッセージと共に終了コード1を返す。

## タブ変数（`tab var`）

```sh
niwaterm tab var set --tab <tabId> <key> <value>
niwaterm tab var get --tab <tabId> <key>
niwaterm tab var list --tab <tabId>
niwaterm tab var find --board <boardId> <key> <value>
```

タブごとのkey-value変数を設定・取得・一覧・検索する（tmuxのペイン変数、`set-option -p`/`show-options -p`相当）。値は文字列固定、キーは`^[A-Za-z0-9_.-]{1,128}$`（英数字・`_`・`-`・`.`のみ、1〜128文字）のみ許可する。変数はレイアウト・cwd等と共に永続化され、アプリを再起動しても同じ位置のタブへ復元される。**ただしtabId自体は再起動のたびに再採番されるため、`tabId`を保存して次回起動後に使い回すことはできない**。対象タブを閉じるとその場で消える。`tabId`を指定すればどのタブからでも別タブの変数を読み書きできるため、送信元タブが自身の状態を`tab var set`で書き、別タブがその値を`tab var get`で参照しつつ`tab send-keys`で操作する、といったタブ間の自動化に使える。指定した`tabId`が存在しない場合、または`tab var get`で指定した`key`が未設定の場合はエラーメッセージと共に終了コード1を返す。

`tab var find`は`key=value`と一致する変数を持つタブのtabIdを1行ずつ表示する（tmuxの`list-panes -F "#{pane_id} #{@role}"` | awk相当）。検索範囲は**1つのBoard内だけ**で、他のBoard・他のワークスペースの一致は含まない。`layout apply`の適用先がBoard単位（ADR 0006）であるため、Boardが「同じレイアウトプリセットのインスタンス」の単位になる。同じプリセットを複数回適用して同じrole名（例: `role=claude`）のタブが何枚も並んでも、自分と同じBoardのタブだけを見つけられる。一致するタブが無ければ何も出力せず終了コード0を返す。役割名でタブを探して`tab send-keys`や`--target-pane`のようなオプションへ渡す、といったレイアウト内タブ間連携の起点として使う（レイアウトプリセットの`command`から使う例は[レイアウトプリセット](/niwaterm/layouts/)参照）。

検索対象のBoardは`--board <boardId>`で明示できる。省略時は`NIWATERM_TAB_ID`環境変数のタブが属するBoard、それも無ければ（niwaterm外のシェルから実行した等）アクティブなBoardを検索する。**「アクティブなBoard」ではなく「実行しているタブの所属Board」を先に見るのが重要**で、レイアウトプリセットの`command`が実際に走るのはPTY起動・シェル初期化を待った後のため、その時点でユーザーが別のBoardへ切り替えていても自分のBoardを正しく指せる。`--board`は`tab var get/set/list`の`--tab`（操作対象のタブ）とは意味が異なり、検索範囲の指定である点に注意する。存在しないboardId・tabIdを指定した場合はエラーメッセージと共に終了コード1を返す。

`tab var set/get/list`の`--tab`は省略可能で、その場合`NIWATERM_TAB_ID`環境変数を使う。niwaterm内で起動したシェルにはこの環境変数が自動設定されているため、そのタブ自身の変数を読み書きする分にはタブIDを調べる必要がない（別タブの変数を操作する場合は`--tab`を明示する）。シェル統合スクリプト（[「シェル統合」](/niwaterm/shell-integration/#シェル統合)参照）はこれを利用してブランチ名等を`tab var set`する。`--tab`省略かつ`NIWATERM_TAB_ID`も無い（niwaterm外のシェルから実行した等）場合はエラーメッセージと共に終了コード1を返す。

## ポップアップ（`popup`）

```sh
niwaterm popup open [--cwd <dir>] [--width <1-100>] [--height <1-100>] [--wait] [--capture-stdout] [command...]
```

タイル・タブに所属しない一時的なポップアップ画面を開く（tmuxの`popup`/`floating`相当。設計判断の詳細: `docs/adr/0005-adopt-workspace-scoped-single-popup.md`）。アクティブなワークスペースにつき最大1つだけ開ける。`--cwd`省略時はフォーカス中タイルのアクティブタブが実際にいるディレクトリを使う。`--width`/`--height`はウィンドウに対する表示サイズ（1〜100のパーセント、省略時は80%）。`command...`を指定すると、デフォルトシェル（WSLプロファイル等も含む）の`-c`/`-Command`相当でそのコマンドを実行し（例: `niwaterm popup open lazygit`）、コマンドが終了すると自動的にポップアップも閉じる（ワンショット実行。lazygit・nvim等のフルスクリーンTUIでも機能する）。省略時は通常のシェルが起動したままになる。成功時、新規`tabId`を表示する。

表示/非表示の切り替えはキーバインド（既定: prefix `ctrl+b` → `` ` ``、macOS/Windows共通）でも行える。GUIでは`popup-box`右上のツールバーからも操作できる。ポップアップが既に開いている場合、このコマンドはエラーメッセージと共に終了コード1を返す。

GUIでは枠の四辺・四隅をドラッグしてサイズを変えられ、ツールバーの空き領域（ボタンより左側）をドラッグして位置を動かせる。OSのウィンドウと同じく、掴んだ辺だけが動いて反対側の辺は固定される。位置・サイズはウィンドウに対するパーセントとして保持されるため、ウィンドウをリサイズしても画面外へはみ出さない。中のプロセスへのサイズ通知はドラッグ中ではなくマウスのボタンを離した時にまとめて1回行う。この値が効くのは今開いているポップアップだけで、`popup toggle`での非表示・再表示では維持されるが、`popup close`・`popup promote`で閉じると破棄され、次に開いたポップアップは既定（中央・80%）に戻る。設定ファイルや`--width`/`--height`の既定値としては保存されない。

**既知の制約**: `command...`は複数の位置引数として渡されるため、CLIパーサーが`-`から始まるトークンを自身のオプションと誤認識する（`--`によるオプション終端はサポートされていない）。`--multi`や`--preview '...'`のようなオプションを含む複雑なコマンドは、呼び出し元シェルの側で1つの引用符文字列にまとめて渡すこと（`niwaterm popup open "fzf --multi --preview 'bat {}'"`のように、シェル全体をダブルクォート等で1トークンにする）。WSLプロファイルではさらに、この1トークンをスペース区切りで単純分割して渡す（クォート・エスケープ非対応、`shell`オプションと同様）。`--capture-stdout`と組み合わせた場合はwsl.exeでも`bash -c`経由の実行に切り替わるため、この制約は無くシェル構文をそのまま使える（後述）。

`--wait`を指定すると、ポップアップが閉じるまで（コマンドの自然終了・`popup close`・GUIでの手動close・`popup promote`によるタブへの昇格のいずれも）コマンドの終了を待つ。省略時（デフォルト）は`tabId`を表示した直後に即座に終了し、ポップアップ内のコマンドはバックグラウンドで動き続ける。`command`を省略した場合はユーザーが手動でポップアップを閉じるまで無期限に待つ。

`--capture-stdout`を指定すると、`command`の標準出力を一時ファイルへリダイレクトしてキャプチャする。ポップアップが閉じた時点で、その内容をこのCLIプロセス自身の標準出力へそのまま出力する（`--wait`は指定しなくても暗黙に有効になる。`command`と同時指定必須）。UI描画自体はポップアップ内にそのまま残るため、fzf等の対話的な選択画面をポップアップ内で見せつつ、選択結果だけを呼び出し元シェルへ直接渡せる。これは`fzf-tmux`が新しいtmux paneでfzfを実行し、標準出力だけをFIFO経由で呼び出し元へ返す設計と同じ発想である。wsl.exeプロファイルでは`bash -c`経由の実行に切り替わる（`/mnt/<drive>/...`形式へ変換した一時ファイルパスへリダイレクトする。`/etc/wsl.conf`でドライブマウント設定を変更している環境では機能しないことがある）。

```sh
selected=$(niwaterm popup open --capture-stdout "fzf --multi --preview 'bat --color=always {}'")
```

このパターンを`fzf-tmux`互換のラッパーとして実装したものが`fzf-niwaterm`コマンド（`packages/cli`に同梱、`@niwaterm/cli`のインストールで一緒にPATHへ入る）。zenoの各widgetや`FZF_CTRL_T_COMMAND`のように「fzfコマンド名を差し替え可能」なツールであれば、`fzf-tmux`を使っていた場所を`fzf-niwaterm`に置き換えるだけで、既存のツール側は無改造のままpopup連携できる。詳細は[packages/cli/README.md](../../packages/cli/README.md#fzf-niwaterm)参照。

```sh
niwaterm popup close
niwaterm popup toggle
niwaterm popup promote
```

開いているポップアップに対する操作コマンド。

- `popup close` — ポップアップを閉じる（中のPTYも終了する）
- `popup toggle` — ポップアップの表示/非表示を切り替える。非表示化してもPTYは生きたままで、裏で動いているプロセスは継続する（成功時 `popup: visible`/`popup: hidden` を表示）
- `popup promote` — ポップアップの中身を、フォーカス中タイル（`niwaterm list`の`(focused)`で確認できる）へ通常タブとして編入する（タブへ昇格）。PTYセッションは作り直されない（成功時、編入先の`tileId`と`tabId`を表示）

開いているポップアップが無い場合、いずれもエラーメッセージと共に終了コード1を返す。

`popup toggle`・`popup promote`はキーバインド（`toggle-popup`・`promote-popup`アクション）とコマンドパレットの「Toggle Popup」「Promote Popup to Tab」からも実行できる。

## フォントサイズ（`font-size`）

```sh
niwaterm font-size increase|decrease|reset
```

ターミナルのフォントサイズを1段階拡大・縮小、またはconfigファイル（`niwaterm.config.ts`の`appearance.fontSize`）の値へリセットする。上限・下限でクランプされる。行高（`appearance.lineHeight`）も設定値との比率を保ったまま追従する（行高を据え置くと、拡大したグリフが行からはみ出して上下の行へ食い込む）。`niwaterm.config.ts`自体は変更しない実行時のみのズームで、キーバインド（既定: prefix `ctrl+b` → `=`/`-`/`0`）・コマンドパレットからの操作とも共有される。成功時、変更後のフォントサイズをpx単位で表示する。

## キーバインドの一覧（`keybind list`）

```sh
niwaterm keybind list
```

現在有効なキーバインドの一覧を表示する（tmuxの`list-keys`相当）。1行目にprefixキーと`repeat-timeout`を出し、続けてprefix経由のバインド（`[prefix]`）・prefix不要の即時発火バインド（`[direct]`）をキー表記順に並べる。

```
prefix: ctrl+b (repeat-timeout: 500ms)

[prefix]
ctrl+b d          split-vertical
ctrl+b h          resize-left (repeat)
ctrl+b r          設定をリロードして通知する

[direct]
ctrl+shift+c      copy-selection
```

右側にはアクション名を表示するが、`niwaterm.config.ts`で`niwa.keybind(key, handler, { description })`と説明を付けたバインドはその説明を表示する（説明の無い関数ハンドラは`function`とだけ表示される）。表示されるのは実際に発火するバインドのみで、キー表記が不正なエントリ（`bindings`側に`ctrl+x`を書いた等）は起動時に無視されるため一覧にも出ない。設定の反映状況の確認に使う。

## 設定値の確認（`config show`）

```sh
niwaterm config show
```

現在有効な設定値の一覧を、設定ファイル（`niwaterm.config.ts`）のトップレベルキーごとに表示する。1行目は読み込んでいる設定ファイルのパスで、一度も読み込めていない場合（ファイルが無い・importに失敗した）はその旨が付く。

設定値の一覧より前に、直近の読み込みが失敗していれば`[読み込みエラー]`が、既定値へ落とした項目・無視した項目があれば`[無視した設定]`が出る。不正な値はその項目だけを落として残りを活かすため、「書いたのに効かない」ときの切り分けはここから始める。

```
config: /Users/you/.config/niwaterm/niwaterm.config.ts

[読み込みエラー]
ResolveMessage: Cannot find module './custom-views/notes-handlers.ts'
直前に読み込めた設定のまま動いています（下の一覧はその内容）

[無視した設定]
- appearance.fontSize: 値が不正なため既定値(13)を使います: "13px"
! keybindings: 関数が途中で失敗しました（失敗より前の登録だけが有効です）: TypeError: ...
```

```
config: /Users/you/.config/niwaterm/niwaterm.config.ts

[appearance]
fontFamily         "HackGen Console NF", monospace
fontSize           16px (設定値 13px + ズーム +3)
lineHeight         22 (設定値 18 をfontSizeのズームで拡大)
foreground         #cdd6f4
background         #1e1e2e
backgroundOpacity  1
backgroundImage    none
ansiColors         #45475a #f38ba8 ...
tabBar             auto

[keybindings]
prefix             ctrl+b
repeatTimeoutMs    500
bindings           30件 (一覧は niwaterm keybind list)
direct             0件 (prefix不要で即時発火するバインド)
...
```

表示されるのは**マージ後の実際に効いている値**で、設定ファイルに書いていない項目は既定値が出る。未設定でも既定値で動く項目（`shell.default`等）は`(未設定)`とフォールバック先を併記する。`fontSize`・`lineHeight`は設定ファイルを見ても今の値が分からない（キーバインド・`font-size`コマンドのズームは設定ファイルを書き換えない）ため、実効値に加えて設定ファイル上の値（`fontSize`はズーム量も）を添える。

値として出せない設定は含まない。関数で書く設定（`mouse.selectionMenu`・`worktree.onCreate`・`worktree.onOpen`・`worktree.onBeforeRemove`・`worktree.onRemove`・`niwa.on`のハンドラ）、キーバインドの個々の割り当て（件数のみ。一覧は`keybind list`）、`worktree`設定（実行するディレクトリとプロジェクトローカル設定に依存するため、アプリ側に「現在の値」が無い）が該当する。`layouts`もアプリが保持しているグローバル設定のプリセット名だけで、プロジェクトローカル分は`layout list`で確認する。

同じ内容はアプリ内のモーダルでも見られる（キーバインド既定: prefix `ctrl+b` → `i`、コマンドパレットの「Show Settings」）。こちらは色の項目にスウォッチが付く。
