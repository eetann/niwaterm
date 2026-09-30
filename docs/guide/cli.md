---
type: Reference
title: CLIからの操作
description: niwaterm CLI（niwatermコマンド）のセットアップとサブコマンド一覧
---

# CLIからの操作

niwatermアプリはunix socket経由のIPCサーバーを持ち、`niwaterm`コマンド（CLI）から操作できる。コマンドは`niwaterm <resource> <verb>`の形でリソース単位にグループ化されている（命名規則は後述）。サブコマンドの全体像は`niwaterm --help`で確認できる。

## セットアップ

```sh
cd packages/cli
bun link
```

`bin`フィールド経由で`niwaterm`コマンドがグローバル（`~/.bun/bin`）に登録される。`~/.bun/bin`がPATHに含まれていない場合は追加する。

このリポジトリの絶対パスに依存するシンボリックリンクになるため、リポジトリを移動・削除すると`niwaterm`コマンドは壊れる。

続けて設定ファイル（キーバインド・外観等）のディレクトリをセットアップする。

```sh
niwaterm init
```

`~/.config/niwaterm/`に`package.json`/`tsconfig.json`/`niwaterm.config.ts`の3ファイルを生成し（`packages/config/examples/`が実体）、`bun install`まで実行する。`package.json`の`@niwaterm/config`依存はこのリポジトリの`packages/config`への絶対パスで自動的に埋まる。既存ファイルは上書きしない（実行済みディレクトリへ再実行しても安全）。依存インストールを飛ばしたい場合は`--skip-install`を付ける。生成先は`NIWATERM_CONFIG_DIR`で変えられる（アプリ側の読み込み先と同じ変数）。設定ファイルの書き方の詳細は`docs/guide/config.md`参照。

## 使い方

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

レイアウトプリセットが紐づいているBoardには`[startup: <name>]`（起動時にそのプリセットで組み直す）または`[preset: <name>]`（プリセット名は覚えているが起動時は骨格を復元する）が付く（「起動時レイアウト」節）。この表示を確認できるよう、紐づけのあるBoardはワークスペース内に1つしか無くてもBoard行を省略しない。

```sh
niwaterm notify --title <title> [--body <body>] [--subtitle <subtitle>] [--silent] [--tab <tabId>]
```

OSのデスクトップ通知を出す。AIエージェントがタスク完了等をユーザーへ知らせる用途を想定（`--title`のみ必須）。macOSでは通知をクリックすると`--tab`のタブへ遷移する。`--tab`省略時はコマンドを実行したタブが遷移先になり、niwaterm外から実行した場合はクリックしても遷移しない。Windowsはクリックしても遷移しない。Windows実機ではElectrobun本体の通知APIが機能しない既知の不具合があり、PowerShell経由の代替実装を使っている（詳細: `docs/known-issues/windows-shell-notifyicon-not-registered.md`）。

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

レイアウト操作コマンド。いずれも対象の`tileId`/`tabId`は`niwaterm list`で確認する。`--tile`/`--tab`を省略した場合の対象は「対象IDの省略」節を参照。

- `tile split` — 指定タイルを分割する（`--orientation`省略時は`vertical`）。`--cwd`省略時は分割対象タイルのアクティブタブが実際にいるディレクトリ（下記「シェル統合」参照。不明ならOS標準）を新規タブの作業ディレクトリに使う。成功時、新規に作られた`tileId`/`tabId`を表示する
- `tab new` — 指定タイルに新規タブを作成する。`--url`指定時はそのURLを開くブラウザタブ、`--custom-view`指定時は`niwaterm.config.ts`の`customViews`設定を開くブラウザタブ（どのビューを開くかは`--view <viewId>`で選ぶ。省略時は設定の先頭。idは`niwaterm config show`で確認）、`--shell`指定時はそのシェルプロファイル（idは`niwaterm shell-profile list`で確認）でターミナルタブ、いずれも省略時はデフォルトシェルの通常のターミナルタブを作成する（`--url`・`--custom-view`・`--shell`は互いに同時指定不可）。`--cwd`で作業ディレクトリを指定できる（ターミナルタブ専用。`--shell`とは併用可、`--url`・`--custom-view`とは同時指定不可）。`--cwd`省略時は`tile split`と同様、対象タイルのアクティブタブが実際にいるディレクトリを使う。成功時、新規`tabId`を表示する
- `tab switch` — 指定タイル内でアクティブタブを切り替える。`--tab`（直接指定）と`--direction`（タブ並び順で1つ次/前へ巡回。端では反対側へ回り込む）はどちらか一方のみ指定でき、両方省略するとエラーになる。`--tile`省略時は`--tab`のタブが属するタイル、`--direction`指定時は実行しているタブのタイル。対象タイルのタブが1枚だけの場合は失敗する
- `tab close` — 指定タブを閉じる（tmuxの`kill-window`相当）。ワークスペース最後の1枚のタイルの最後のタブは誤操作防止のため閉じられない。引数を全て省略すると実行しているタブ自身が閉じる
- `tab restart` — 指定タブのプロセスを強制終了し、同じ`tabId`・タイル位置のまま再起動する（tmuxの`respawn-pane -k`相当、対象がブラウザタブの場合は失敗する）。`--shell`省略時はデフォルトシェル、`--cwd`省略時は元のタブが実際にいるディレクトリを引き継ぐ。`--command`を指定すると、シェルの代わりにそのコマンドを実行する（`popup open`の位置引数と同じ意味のワンショット実行）。GUIのキーバインドからこの操作を割り当てた場合は実行前にy/nの確認ダイアログを挟むが、CLIからの実行に確認は無い
- `tile focus` — タイルへフォーカスを移す。`--tile`（直接指定）と`--direction`（現在フォーカス中のタイルから見て指定方向にある最も近いタイルへ移動。該当タイルが無ければ何もしない、エラーにはならない。常にアクティブなワークスペース基準で動く）はどちらか一方のみ指定できる。どちらも省略すると実行しているタブのタイルへフォーカスを移す（背面のタブから自分を前に出す用途）
- `tile resize` — 指定タイルを指定方向へ拡大する（tmuxの`resize-pane`相当）。`--amount`省略時は既定の1ステップ分。`--direction`の軸に一致するsplitが祖先に無い場合（単一タイルのワークスペース等）は失敗する
- `tile zoom` — 指定タイルの一時的なズーム表示を切り替える（tmuxの`resize-pane -Z`相当）。他のタイルを隠して画面全体に表示し、再度実行すると解除する。ズーム中のタイルを分割する、または他のタイルへフォーカスを移すと自動的に解除される

いずれも対象の`tileId`/`tabId`が存在しない場合はエラーメッセージと共に終了コード1を返す。

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

`--tile`等を省略したときの対象は「そのコマンドを実行しているタブが載っているウィンドウ」になる（「対象IDの省略」節）。

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
- `board close` — 指定したBoardを閉じる。ワークスペース内最後の1つでも、他にワークスペースがあればBoard 0個の状態で残せる（「Boardが0個のワークスペース」節を参照）。ワークスペースも1つだけの場合は閉じるとウィンドウごと畳むことになるため、誤操作防止で閉じられない。`--board`省略時は実行しているタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）
- `board rename` — 指定したBoardの名前を変更する。`<name>`に空文字列を指定すると設定`board.naming`による自動命名へ戻る（[設定ガイド](/guide/config.md)の「自動命名」節）。`--board`の省略時の扱いは`board close`と同じ
- `board move` — Boardを動かす。`--up`/`--down`/`--to-workspace`のいずれか1つが必須
  - `--up` / `--down` — 所属ワークスペース内での表示順（サイドバーの並び）を1つ上・1つ下へ移動する。中身（タイル・タブ）とアクティブなBoardは変わらない。既に端にいて動かせない場合は何もせず成功扱いになる。並び順は名前同様アプリ再起動をまたいでも復元される（離れた位置へまとめて動かしたい場合はサイドバーのドラッグ&ドロップ、または設定ファイルの`niwa.board.move(boardId, index)`を使う）
  - `--to-workspace <workspaceId>` — Boardを別のワークスペースへ移す（tmuxの`move-window`相当）。レイアウト・タブ・実行中のプロセスはそのまま移り、移動先ワークスペースの末尾に付く。アクティブなBoardは移動元・移動先とも変わらない。移動元がこれでBoard 0個になっても、そのワークスペースは残る（開いているポップアップだけは閉じる）
- `board phase` — そのBoardの作業フェーズ（サイドバーのBoard行に出るバッジ）を設定・解除・表示する。`set`に渡す`<phase>`は`niwaterm.config.ts`の`board.phases`で定義したid（未定義の任意の文字列も渡せて、その場合は文字列がそのまま既定色のバッジになる）。`show`は現在の値を1行で表示し（未設定なら空行）、`clear`で解除する。`--board`の省略時の扱いは`board close`と同じなので、エージェントのhookからそのタブのBoardへ付けられる。候補の定義とサイドバー・キーバインドからの切り替えは`docs/guide/config.md`「Board設定」節を参照
- `board startup` — そのBoardを次回起動時にどう組み直すかを設定する（`--board`省略時は現在アクティブなBoard）。「起動時レイアウト」節を参照
- `board worktree` — そのBoardに紐づくワークツリーを設定・解除・表示する（`--board`省略時の扱いは`board close`と同じ）。`docs/guide/worktree.md`「Boardに紐づくワークツリー」節を参照

いずれも対象の`boardId`（`board new`は`workspaceId`）が存在しない場合、`board close`はさらにワークスペースが1つだけの状態でその最後の1つを指定した場合もエラーメッセージと共に終了コード1を返す。

アクティブなBoardに対する同じ操作は、キーバインド（`new-board`・`close-board`・`rename-board`等のアクション）とコマンドパレット、サイドバーの右クリックからも行える。コマンドパレットには切り替え先ごとに「Switch to Board: <名前>」もワークスペース横断で並ぶ。

### Boardが0個のワークスペース

Boardをすべて閉じてもワークスペース自体は残る（名前・表示順もそのまま）。レビュー中のワークツリーのように、対象が常に存在するとは限らない作業の置き場としてワークスペースを用意しておけるようにするため。この状態のワークスペースは画面中央に案内を出し、そこから新しいBoardを作れる（`board new`でも同じ）。アプリを再起動しても空のまま復元される。

ただしウィンドウ内にそのワークスペースしか無い場合は、従来どおりウィンドウを畳む（「最後のタブを閉じたらniwatermが終了する」という導線を保つため）。

```sh
niwaterm layout list [--cwd <dir>]
niwaterm layout apply <name> [--replace | --replace-force] [--board <boardId>] [--workspace <workspaceId>] [--cwd <dir>] [--startup] [--trust]
```

`niwaterm.config.ts`の`layouts`（詳細: `docs/guide/config.md`「レイアウト」節）とプロジェクトローカルの`.niwaterm/config.ts`（「プロジェクトローカルのレイアウト」節）で定義したプリセットを一覧・適用する（[vde-layout](https://github.com/yuki-yano/vde-layout)ライク）。適用先はBoard単位（ADR 0006、`docs/adr/0006-adopt-board-layer-between-workspace-and-tile.md`）。

- `layout list` — 定義済みプリセットを`name<TAB>解決元<TAB>description`形式で表示する。解決元は`[project: <projectRoot>]`・`[global]`・`[builtin]`のいずれか。`--cwd`はプロジェクトローカルのプリセットを探す起点で、省略時は実行したディレクトリ。ユーザー定義が1件も無い場合はビルトインだけが並び、その旨を併せて表示する
- `layout apply <name>` — 指定したプリセットを適用する。デフォルトは新規Boardとして適用し（`--workspace`省略時は現在アクティブなワークスペース配下）、成功時にその`boardId`を表示する。`--replace`は既存Board（`--board`省略時は現在アクティブなBoard）を単一タイルへ畳んでから適用し直す（**既存タブ・PTYは無条件でcloseされる**）。`--replace`は実行前に対象を明示したy/n確認プロンプトを表示する（TTYでない場合は確認できないためエラーで終了する）。ただし対象Boardがタイル1つ・タブ1つだけのときは閉じて失われるものが無いため、確認プロンプトは出ない（非対話環境でも実行できる）。`--replace-force`は`--replace`と同じ効果で確認プロンプトを省略する。`--replace`/`--replace-force`と`--workspace`、いずれも未指定時の`--board`は同時指定不可。`--cwd`は各タブの`cwd`未指定時に使う作業ディレクトリで、省略時は`niwaterm layout apply`を実行したディレクトリになる（プロジェクトローカル由来のプリセットでは`--cwd`ではなくプロジェクトルートが基準になる。`--replace`/`--replace-force`時、最初に到達するタイルだけは既存タブを使い回すが、そのタブのPTYも基準cwdで起動し直されるためタイル間でcwdが食い違うことはない）。成功時は`board: <boardId><TAB>preset: <name>`を表示し、プロジェクトローカル由来なら`[project: <projectRoot>]`が付く

指定した`name`が未定義の場合、指定した`workspaceId`/`boardId`が存在しない場合、プリセットの検証に失敗した場合はいずれもエラーメッセージと共に終了コード1を返す（検証失敗の主な原因は`shellProfile`の未知のid、`focus:true`の重複、ratioの範囲外指定等）。検証失敗時はBoardに一切変更を加えない。

### ビルトインのプリセット

設定ファイルに何も書かなくても使えるプリセットがある。`layout list`では解決元が`[builtin]`と表示され、同名のプリセットを`niwaterm.config.ts`や`.niwaterm/config.ts`に定義するとそちらが優先されてビルトインは隠れる。

```sh
# 今のBoardを片付けて、タイル1つ・タブ1つの状態に戻す
niwaterm layout apply empty --replace
```

- `empty` — Boardをタイル1つ・タブ1つへ畳む。**残る1タブもシェルを起動し直す**ので、そのBoardで動いていたプロセスは1つ残らず止まる。引き継ぐのは残るタブの作業ディレクトリだけで、タブ名・タイル名・タブ変数は消える（他のプリセットと違い`--cwd`は見ない。片付けた結果として知らないディレクトリに立っている、という状態を避けるため）。残る1タブがブラウザタブだった場合はterminalタブへ置き換わる。`--replace`を付けなければ空のBoardを1つ作るだけなので、`board new`と同じ意味になる

### 起動時レイアウト

niwatermは終了時のレイアウト（タイル構成・タブの名前・シェル・cwd・タブ変数）を保存し、次回起動時に復元する。ただし復元されるのは骨格だけで、プリセットの`command`は再実行されない。「このBoardは毎回このレイアウトで立ち上げたい」場合は`--startup`を使う。

```sh
# このプリセットでBoardを作り、次回以降の起動時も同じ構成で立ち上げる
niwaterm layout apply dev --startup

# 既存Boardを後から起動時レイアウトへ切り替える／戻す
niwaterm board startup layout --board board-12 --preset dev
niwaterm board startup restore --board board-12
niwaterm board startup clear --board board-12
```

`layout apply`は成功したBoardに適用したプリセット名を必ず記録する。`--startup`を付けた場合だけそのBoardが起動時の組み直し対象（`restoreMode: "layout"`）になり、付けなければ名前を覚えるだけで従来どおり保存した骨格を復元する。

`worktree new`／`worktree open`の`--layout`だけは`--startup`を付けずとも紐づく。あちらはBoardの中身をプリセットが決めているため（`docs/guide/worktree.md`「レイアウトプリセットの適用」節）。

`board startup <mode>`のmodeは次の3つ。`--preset`を省略すると、そのBoardに既に記録されているプリセット名を（プロジェクトローカル由来ならその解決元ごと）引き継ぐ（一度も`layout apply`していないBoardでは`--preset`が必須）。

- `layout` — 起動時にプリセットで組み直す。保存した骨格は使わないので、前回セッションのタブ名・タブ変数・cwdは持ち込まれず、プリセットの`command`も改めて実行される
- `restore` — 保存した骨格を復元する（既定の挙動）。プリセット名の記録自体は残るので、あとから`layout`へ戻せる
- `clear` — プリセットの紐づけごと解除する

起動時にタブが開くディレクトリは、紐づけを作った時点のもの（`layout apply`・`board startup --preset`を実行したディレクトリ、`--cwd`を渡したならその値。`worktree new`／`worktree open`で開いたBoardならそのワークツリー）になる。プロジェクトローカル由来のプリセットの場合だけは実行ディレクトリではなく解決元の`projectRoot`が基準になる（どこから実行しても同じ構成を再現するため）。いずれの場合も、プリセット側で`cwd`を指定したタブはそちらが優先される。別のディレクトリで開き直したくなったら、そのディレクトリで`layout apply <name> --replace --startup`（または`board startup layout --preset <name>`）を実行して紐づけ直す。`board startup`で`--preset`を省略したときはモードだけが変わり、記録済みのディレクトリはそのまま引き継がれる。

起動時にプリセットが設定から消えていた場合、そのBoardは単一タブのまま残り、デスクトップ通知でその旨を知らせる（骨格は復元されない）。プリセット名を変える際は`board startup`で追随させること。プロジェクトローカル由来の場合は、記録された`projectRoot`が消えている・`.niwaterm/config.ts`からプリセットが消えている場合も同じ扱いになる。

サイドバーのBoard行を右クリック → 「起動時レイアウト」からも設定できる。**プリセットを選ぶとその場でBoardへ適用し、同時に起動時レイアウトとしても紐づける**（`layout apply <name> --replace --startup --board <boardId>`と同じ）。次回の起動を待たずに結果が見えるので、意図と違うプリセットを選んだことにその場で気づける。既存タブ・PTYを閉じる破壊的操作なので確認ダイアログが出る（プロジェクトローカル由来なら、その中でtrustの確認文も併せて示される）。「紐づけを解除」は`board startup clear`にあたる（コマンドパレットの「Clear Board Startup Layout」・キーバインドの`clear-board-startup`アクションも同じ操作で、対象はアクティブなBoard）。

プリセット一覧はそのBoardのフォーカス中タブのcwdから解決するため、そのタブで`layout list`を叩いたときと同じ顔ぶれになる（プロジェクトローカルのプリセットには`project`が付く）。紐づけのあるBoard行にはアイコンが出て、起動時に組み直すBoard（`layout`）だけ色が付く。`restore`モードへの切り替え（紐づけを残したまま起動時の組み直しだけ止める）はサイドバーには無いので`board startup restore`を使う。

### プロジェクトローカルのレイアウト

リポジトリ内の`<projectRoot>/.niwaterm/config.ts`にレイアウトプリセットを置くと、そのリポジトリでだけ使えるプリセットになる。チーム内でレイアウトを共有したい場合や、リポジトリごとにタイル構成が違う場合に使う。

```ts
// .niwaterm/config.ts
import type { NiwatermProjectConfig } from "@niwaterm/config";

export default {
  layouts: {
    dev: {
      description: "editor + test watcher",
      layout: {
        kind: "split",
        orientation: "vertical",
        ratio: 0.6,
        first: { kind: "tile", tabs: [{ name: "editor", command: "nvim" }] },
        second: { kind: "tile", tabs: [{ name: "test", cwd: "./packages/cli", command: "bun test --watch" }] },
      },
    },
  },
} satisfies NiwatermProjectConfig;
```

`import type`はトランスパイル時に消えるため、リポジトリに`@niwaterm/config`が入っていなくてもそのまま動く（型補完が欲しい場合だけ入れればよい）。グローバル設定と違い`defineConfig`のようなランタイムヘルパーは使わず、素のオブジェクトをdefault exportする。

**解決の仕組み**

`.niwaterm/`は暗黙に探されるわけではなく、次の2つの場面でだけ参照される。

- **CLI・API実行時**（`layout list` / `layout apply` / `board startup --preset`） — 実行したディレクトリ（`--cwd`）から上向きに`.niwaterm/`を探す。見つからない場合はgitのメインワークツリー側の`.niwaterm/`も見る（リンクされたワークツリーに`.niwaterm/`をコミットしていない運用のため）。このフォールバックはniwatermアプリ側で`git`を実行するので、アプリが動いているマシンにgitが無い場合（WSLのリポジトリをWindows側のniwatermから開いている等）は効かない
- **`worktree new` / `worktree open`の`--layout`** — 上の探索は行わず、メインワークツリー直下の`.niwaterm/`だけを見る（`worktree.*`の設定と同じ解決起点。上のフォールバックに頼らないので、アプリ側にgitが無くても引ける）
- **起動時**（起動時レイアウト） — cwdが存在しないため探索は行わず、紐づけを作った時点の解決元（`projectRoot`）をそのまま読む

Boardが複数のディレクトリのタブを開いていても解決先は曖昧にならない。Boardが覚えているのは「どのプロジェクトのプリセットで組まれたか」という出自1つで、タブのcwdは解決に使われないため。

**同名プリセットはプロジェクト側が優先される**。どちらが適用されるかは`layout list`の解決元列で確認できる。

タブの`cwd`はプロジェクトルート基準の相対パスで書ける（`cwd`省略時のデフォルトもプロジェクトルート）。プリセットをリポジトリごと持ち運んでも同じ構成を再現できる。

**信頼（trust）**

プロジェクトローカルのプリセットを**起動時レイアウトへ紐づける**とき（`layout apply <name> --startup`、`board startup layout`）だけ、y/nの確認プロンプトが出る。紐づけると以後アプリを起動するたびにそのリポジトリの`.niwaterm/config.ts`が評価され、プリセットの`command`がシェルへ流し込まれるため、cloneしてきたリポジトリのコードが自動実行されることになる。信頼できるリポジトリでのみ許可すること。

- グローバル設定由来のプリセットでは確認は出ない（ユーザー自身の設定のため）
- 紐づけを伴わない一度きりの`layout apply`でも確認は出ない（ユーザーがそのディレクトリで明示的に実行しているため）。ただし同名プリセットの影に隠れて気づかない事故を避けるため、適用したプリセットの解決元は必ず出力に表示される
- 非対話環境（パイプ・スクリプト実行等）ではハングせずエラーで終了する。確認をスキップするには`--trust`を使う
- サイドバーの右クリックから紐づける場合も等価の確認が出る（TTYのy/Nの代わりにモーダルダイアログ）。CLIは「trust」「既存タブを閉じる」を2回に分けて聞くが、サイドバーは読み飛ばされにくいよう1枚のダイアログへまとめている。判定と文面はCLIと共通の1箇所（`src/bun/board-startup.ts`の`checkLayoutTrust`）にあるため、入口が増えても確認を通らずに紐づけが作られることはない
- `--replace`と併用した場合、trustの確認が先、既存タブを閉じる確認が後になる。信頼しない場合に破壊的な確認へ先に答えさせないため
- 確認は「起動時の自動実行を有効にする操作」ごとに出る。`board startup restore`で一度止めてから`board startup layout`で戻す場合も、改めて確認が出る（解決元の記録は残っているが、自動実行を再び有効にするのはガードすべき操作という判断）
- 信頼の記録は専用のストアを持たない。起動時に自動実行される経路は起動時レイアウトの紐づけ1本だけで、それは必ずこの確認を通ってしか作られないため。紐づけを外す（`board startup restore`／`clear`）と起動時の自動実行も止まる
- trust後に`git pull`等で`.niwaterm/config.ts`の内容が変わった場合の再確認は行わない（内容ハッシュを持たない）
- `worktree new`／`worktree open`の`--layout`もプリセットを起動時レイアウトへ紐づけるが、確認はワークツリー側の承認（`docs/guide/worktree.md`「プロジェクトローカル設定の承認」節）が兼ねるため、ここの確認は重ねて出ない。あちらは内容ハッシュ付きの記録を持つので、`.niwaterm/`の中身が変われば改めて確認が出る

```sh
niwaterm sidebar switch --view <viewId>
```

サイドバーに出すビューを切り替える。`<viewId>`はワークスペース一覧の`workspaces`か、`niwaterm.config.ts`の`customViews`のid（どちらも`niwaterm config show`で確認できる）。サイドバーを閉じている場合は開いた上で切り替える。キーバインド（順送りの`next-sidebar-view`・id指定の`show-sidebar-view:<id>`）・コマンドパレットからの操作と同じもので、設定の詳細は`docs/guide/config.md`「ユーザー定義HTML UI（customViews）」節を参照。存在しないidを指定した場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm status-bar refresh [--item <id>]
niwaterm status-bar toggle [--visible on|off]
```

ウィンドウ下端のステータスバー（設定の`statusBar`。詳細は`docs/guide/config.md`「ステータスバー（statusBar）」節）を操作する。どちらも全ウィンドウが対象で、呼び出し元のウィンドウは問わない。

- `status-bar refresh` — 部品を状況が変わっていなくても評価し直す。`render`がniwatermの外の状態（gitの状態・ファイル等）を読む場合に、変えた側から変化を知らせるためのもの。`--item`でその部品だけに絞る。`<id>`は部品の`id`フィールド（付けていなければ`left-0`のような区画-番号）で、`niwaterm config show`の`statusBar`で確認できる。存在しないidはエラーメッセージ（今あるidの一覧付き）と共に終了コード1を返す。バーを隠している間は何も評価せず、出し直した時にまとめて評価する
- `status-bar toggle` — バーの表示/非表示を切り替える。`--visible on`/`off`で向きを指定でき、省略時は今の逆になる。隠した状態は次回起動時にも引き継ぐ（成功時 `status-bar: visible`/`status-bar: hidden` を表示）

`statusBar: false`で出さない設定にしている場合は、いずれもエラーメッセージと共に終了コード1を返す。キーバインド（`refresh-status-bar`・`toggle-status-bar`アクション。既定キーは無い）とコマンドパレットの「Refresh Status Bar」「Toggle Status Bar」からも実行できる。

```sh
niwaterm font-size increase|decrease|reset
```

ターミナルのフォントサイズを1段階拡大・縮小、またはconfigファイル（`niwaterm.config.ts`の`appearance.fontSize`）の値へリセットする。上限・下限でクランプされる。行高（`appearance.lineHeight`）も設定値との比率を保ったまま追従する（行高を据え置くと、拡大したグリフが行からはみ出して上下の行へ食い込む）。`niwaterm.config.ts`自体は変更しない実行時のみのズームで、キーバインド（既定: prefix `ctrl+b` → `=`/`-`/`0`）・コマンドパレットからの操作とも共有される。成功時、変更後のフォントサイズをpx単位で表示する。

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

```sh
niwaterm shell-profile list
```

利用可能なシェルプロファイル一覧を`id<TAB>name<TAB>command`形式で表示する。`tab new --shell`に指定する`id`はここで確認する。プロファイルはniwaterm.config.tsの`shell.profiles`（詳細: `docs/guide/config.md`「シェル設定」節）と、Windows環境では起動時に自動検出したWSLディストロ・PowerShellから構成される。1件も無い場合はその旨を表示する。

```sh
niwaterm tab capture [--tab <tabId>]
```

指定したタブの現在の画面内容をプレーンテキストで標準出力へ表示する（tmuxの`capture-pane -p`相当）。エスケープシーケンス・色情報は含まれず、現在画面（viewport）の内容のみが対象でスクロールバックは含まれない。`--tab`省略時は実行しているタブ自身の画面を取得する。指定したtabIdが存在しない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm tab var set --tab <tabId> <key> <value>
niwaterm tab var get --tab <tabId> <key>
niwaterm tab var list --tab <tabId>
niwaterm tab var find --board <boardId> <key> <value>
```

タブごとのkey-value変数を設定・取得・一覧・検索する（tmuxのペイン変数、`set-option -p`/`show-options -p`相当）。値は文字列固定、キーは`^[A-Za-z0-9_.-]{1,128}$`（英数字・`_`・`-`・`.`のみ、1〜128文字）のみ許可する。変数はレイアウト・cwd等と共に永続化され、アプリを再起動しても同じ位置のタブへ復元される。**ただしtabId自体は再起動のたびに再採番されるため、`tabId`を保存して次回起動後に使い回すことはできない**。対象タブを閉じるとその場で消える。`tabId`を指定すればどのタブからでも別タブの変数を読み書きできるため、送信元タブが自身の状態を`tab var set`で書き、別タブがその値を`tab var get`で参照しつつ`tab send-keys`で操作する、といったタブ間の自動化に使える。指定した`tabId`が存在しない場合、または`tab var get`で指定した`key`が未設定の場合はエラーメッセージと共に終了コード1を返す。

`tab var find`は`key=value`と一致する変数を持つタブのtabIdを1行ずつ表示する（tmuxの`list-panes -F "#{pane_id} #{@role}"` | awk相当）。検索範囲は**1つのBoard内だけ**で、他のBoard・他のワークスペースの一致は含まない。`layout apply`の適用先がBoard単位（ADR 0006）であるため、Boardが「同じレイアウトプリセットのインスタンス」の単位になる。同じプリセットを複数回適用して同じrole名（例: `role=claude`）のタブが何枚も並んでも、自分と同じBoardのタブだけを見つけられる。一致するタブが無ければ何も出力せず終了コード0を返す。役割名でタブを探して`tab send-keys`や`--target-pane`のようなオプションへ渡す、といったレイアウト内タブ間連携の起点として使う（レイアウトプリセットの`command`から使う例は`docs/guide/config.md`「レイアウト」節参照）。

検索対象のBoardは`--board <boardId>`で明示できる。省略時は`NIWATERM_TAB_ID`環境変数のタブが属するBoard、それも無ければ（niwaterm外のシェルから実行した等）アクティブなBoardを検索する。**「アクティブなBoard」ではなく「実行しているタブの所属Board」を先に見るのが重要**で、レイアウトプリセットの`command`が実際に走るのはPTY起動・シェル初期化を待った後のため、その時点でユーザーが別のBoardへ切り替えていても自分のBoardを正しく指せる。`--board`は`tab var get/set/list`の`--tab`（操作対象のタブ）とは意味が異なり、検索範囲の指定である点に注意する。存在しないboardId・tabIdを指定した場合はエラーメッセージと共に終了コード1を返す。

`tab var set/get/list`の`--tab`は省略可能で、その場合`NIWATERM_TAB_ID`環境変数を使う。niwaterm内で起動したシェルにはこの環境変数が自動設定されているため、そのタブ自身の変数を読み書きする分にはタブIDを調べる必要がない（別タブの変数を操作する場合は`--tab`を明示する）。シェル統合スクリプト（下記「シェル統合」参照）はこれを利用してブランチ名等を`tab var set`する。`--tab`省略かつ`NIWATERM_TAB_ID`も無い（niwaterm外のシェルから実行した等）場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm tab hover list [--tab <tabId>]
niwaterm tab hover reveal --position <position> [--tab <tabId>]
niwaterm tab hover hide [--tab <tabId>]
```

タブの端に出るホバーボタン（設定の`hoverButtons`。詳細は[設定ガイド](/guide/config.md)参照）を確認・強制表示する。`list`はそのタブで今出せる枠と、その枠に並ぶ項目を`<position>\t<id>`とインデント付きの項目名で表示する。項目は画面に出すときと同じ経路で組み立てるため、`items`が返すものをそのまま確認できる。

`reveal`は取っ手を押した（マウスを寄せた）状態と同じ表示を、マウスの出入りに関係なく出したままにする。取っ手の有無にかかわらず、その位置の枠を全て並べる。`hide`で解除する（項目を押した場合・枠の外を押した場合・Escを押した場合・設定をリロードした場合も解除される）。取っ手のクリックやホバーは合成入力では当てにくいため、実機での目視・スクリーンショット確認にはこちらを使う。`--position`はタブの表示領域の端8方向（`top-left` / `top` / `top-right` / `left` / `right` / `bottom-left` / `bottom` / `bottom-right`）から選ぶ。その位置に出せる枠が無い場合はエラーメッセージと共に終了コード1を返す。

`--tab`省略時はそのコマンドを実行しているタブ（niwaterm外から実行した場合はフォーカス中タイルのアクティブタブ）が対象になる。

### ワークツリー

```sh
niwaterm worktree list [--cwd <dir>]
niwaterm worktree new <branch> [--track <mode>] [--remote <name>] [--fetch|--no-fetch] [--from <ref>] [--path <dir>] [--open <mode>] [--layout <name>] [--workspace <workspaceId>] [--name <name>] [--trust] [--cwd <dir>]
niwaterm worktree open <worktree> [--open <mode>] [--layout <name>] [--workspace <workspaceId>] [--name <name>] [--trust] [--cwd <dir>]
niwaterm worktree remove <worktree>... [--force] [--delete-branch] [--keep-board] [--trust] [--cwd <dir>]
```

gitのワークツリーを一覧・作成・削除し、それぞれをBoardとして開くコマンド。`list`はワークツリー一覧をTSVで表示するだけ、`new`／`open`は対象のワークツリーをBoardとして開き（`--open`で開き方を選ぶ）、`remove`はワークツリーをディレクトリごと削除してそのBoardを閉じる。`<worktree>`はブランチ名・パス・ディレクトリ名のいずれでも指定でき、`remove`だけはスペース区切りで複数渡せる。

`new`の`<branch>`はローカル → リモート → 新規作成の順に探す（`--track`で選べる）。`origin/feat/x`のようにリモート名を付けて渡すとリモートからの作成を明示でき、作る前に`git fetch`が1回走る（`--no-fetch`で抑止）。

`list`と`new --open none`はniwatermアプリへ接続しないため、アプリが起動していない普通のターミナルからも使える。

置き場所の決め方・リモートのブランチからの作成・作成後／削除前後のフック・レイアウトプリセットの適用・プロジェクトローカル設定の承認と、Boardとの紐づけ（`board worktree`）を含めた全体は`docs/guide/worktree.md`（`niwaterm docs show worktree`）を参照。

## 対象IDの省略

多くのコマンドは`--tile`/`--tab`/`--board`/`--workspace`を省略でき、その場合は**そのコマンドを実行しているタブ**が対象になる。niwatermが起動したシェルには`NIWATERM_TAB_ID`環境変数が入っており、CLIはそれを起点に所属タイル・Board・ワークスペースを解決する。niwatermの外（普通のターミナル・スクリプト）から実行した場合は、アクティブなワークスペース→アクティブなBoard→フォーカス中タイル→そのアクティブタブへフォールバックする（tmuxの`current-pane`相当）。

ウィンドウが複数開いている場合、フォールバック先は**実行しているタブが載っているウィンドウ**になる（CLIは全リクエストに`NIWATERM_TAB_ID`を添えて送る）。niwatermの外から実行した場合は最後にフォーカスされたウィンドウが対象になる。`workspace new`・`popup open`のように対象IDを取らないコマンドも同じ規則で宛先のウィンドウが決まる。

明示指定した値がこの解決結果で上書きされることはない。存在しないIDを渡しても別の対象へすり替わらず、そのままエラーになる。`--tab`だけを指定して`--tile`を省略した場合は、実行元ではなく**指定したタブが属するタイル**が埋まる（`tab close --tab <tabId>`のような使い方ができる）。

省略できないのは、自分自身を指しても意味が無い切り替え系（`tab switch`の`--tab`/`--direction`、`board switch --board`、`workspace switch --workspace`）、誤送信を避けたい`tab send-keys --tab`、対象がブラウザタブに限られる`browser *`の`--tab`。`tab var`系の`--tab`は`NIWATERM_TAB_ID`のみを見て、フォーカス中タブへのフォールバックは行わない（シェル統合・エージェント統合のhookがniwaterm外で暴発しないようにするため）。

## シェル補完

```sh
niwaterm complete zsh
```

補完スクリプトを標準出力へ書き出す。`bash` / `zsh` / `fish` / `powershell` を指定できる。設置先はシェルごとに違う。

```sh
# zsh: fpathの通ったディレクトリへ、先頭にアンダースコアを付けた名前で置く
mkdir -p ~/.zsh/completions
niwaterm complete zsh > ~/.zsh/completions/_niwaterm
# ~/.zshrcのcompinitより前に fpath=(~/.zsh/completions $fpath) を書く
```

置き先は書き込めるディレクトリを選ぶ。すでにfpathへ入れてあるディレクトリでも、home-manager・Nix・dotfilesのシンボリックリンクで読み取り専用の実体を指していることがあり、そこへは生成できない（`read-only file system`で失敗する）。

```sh
# bash: bash-completionが読むディレクトリへ置く（bash-completion本体の導入が前提）
mkdir -p ~/.local/share/bash-completion/completions
niwaterm complete bash > ~/.local/share/bash-completion/completions/niwaterm
```

```sh
# fish: 置くだけで読み込まれる
mkdir -p ~/.config/fish/completions
niwaterm complete fish > ~/.config/fish/completions/niwaterm.fish
```

```powershell
# PowerShell: プロファイルへ追記する
niwaterm complete powershell >> $PROFILE
```

補完されるのはコマンド名・オプション名だけでなく、`--tab`に渡すtabIdのような**値**も含む。候補の取得元は3種類ある。

- **起動中のniwatermアプリ** — tabId・tileId・boardId・workspaceId・windowId、シェルプロファイルのid、レイアウトプリセット名、customViewのid、Boardのフェーズ。IDだけでは何を指すか分からないため、候補にはBoard名・ワークスペース名を説明として添える
- **補完を実行したディレクトリ** — gitワークツリー・gitリモート、`--cwd`のようなパスを取る引数
- **CLI自身** — `docs show`のドキュメント名、`--direction`のように取りうる値が決まっている引数

アプリが起動していないときはアプリ由来の候補が空になるだけで、コマンド名・オプション名の補完はそのまま効く。問い合わせの待ち時間には短い上限があり、応答が無ければ候補ゼロで打ち切る。

補完の対象になるコマンド名は、スクリプトを生成したときの呼び出し名になる。開発用の`niwaterm-dev`（`mise run cli:link`が張る別名）から生成すれば`niwaterm-dev`用のスクリプトが出て、候補の問い合わせ先もそちらの既定インスタンスになる。

### 置き直しが要るとき

スクリプトはコマンドの一覧を持たない（補完のたびにCLIへ問い合わせる）ので、**コマンドやオプションが増減しても中身は変わらず、置き直す必要は無い**。生成し直すのは補完スクリプト自体の作り方が変わったとき、つまり`@gunshi/plugin-completion`を更新したときだけ。

zshなら、シェルの起動時に「無ければ作る」形にしておくと設置を忘れずに済む。**置く位置は`compinit`を呼ぶ前**——既存の`fpath=(...)`を並べている場所の隣がよい。`compinit`はそれを呼んだ時点のfpathしか見ないため、後ろに置くと補完はいつまでも登録されない（`niwaterm boa`でタブキーを押しても何も起きない、という形で出る）。

```zsh
# 生成物なので、dotfilesの配下ではなく書き込めるキャッシュへ置く
_niwaterm_comp="${XDG_CACHE_HOME:-$HOME/.cache}/zsh/completions/_niwaterm"
if [[ ! -f $_niwaterm_comp ]] && (( $+commands[niwaterm] )); then
  mkdir -p ${_niwaterm_comp:h}
  # 一時ファイルはプロセスごとに分ける。niwatermは起動時に複数のタブのシェルを
  # 同時に立ち上げるため、固定名だと先にmvした1つ以外が"cannot stat"で落ちる。
  # 生成に失敗したときに中途半端なファイルを残さない意味もある
  # （compinitがそれを読むと補完が壊れる）
  _niwaterm_tmp="$_niwaterm_comp.$$"
  if niwaterm complete zsh > $_niwaterm_tmp; then
    mv $_niwaterm_tmp $_niwaterm_comp
    # compinitのdumpを使い回す構成（compinit -C）はfpathを再スキャンしないため、
    # 新しく置いた補完ファイルが拾われるようdumpも捨てる
    rm -f "${ZSH_CACHE_DIR:-$HOME/.cache/zsh}/zcompdump"
  else
    rm -f $_niwaterm_tmp
  fi
  unset _niwaterm_tmp
fi
fpath=(${_niwaterm_comp:h} $fpath)
```

補完が効いているかは`compinit`のdumpを見ると分かる。`grep -c niwaterm ~/.cache/zsh/zcompdump`が0なら、`compinit`の時点でfpathに入っていない。置き場所や順序を直してもまだ0のままなら、補完ファイルが既にあるせいで上のブロックごと飛ばされ、dumpが捨てられていない。dumpと`.zwc`を一度消せば次の起動で拾われる。

生成のたびにバージョンを調べて作り直す（`mise activate`のキャッシュのような）作りにする必要は無い。中身がバージョンに依らないうえ、判定のために`niwaterm --version`を呼ぶ時間が生成そのものと変わらないため。

## シェル統合

`contrib/shell-integration/`配下のスクリプトをシェルの起動時にsourceすると、プロンプト表示のたびに現在のgitブランチをタブ変数`branch`へ自動反映する（`niwaterm tab var set branch <branch>`相当を内部で呼ぶ）。サイドバーのタブ行にブランチ名が表示されるようになる。zsh/bash/fish/PowerShellに対応している。

同スクリプトはカレントディレクトリもOSC 7（`kitty-shell-cwd://`スキーム）で通知し、タブ変数`cwd`へ自動反映する（`niwaterm tab var set`のCLI呼び出しは経由しない、ターミナルのネイティブ機能）。libghostty-vt（vt-only版）はURIを未パースのまま返す仕様のため、パスのデコードはniwaterm側（`src/bun/pwd-report.ts`）で行っている。ホスト名検証はしていない。ghostty本家はSSH越しの偽装対策としてホスト名を検証する。niwatermはWSLディストロをシェルプロファイルとして正式サポートしており、その場合シェル側とniwaterm本体側のホスト名は常に不一致になるため、意図的に検証を省いている。`niwaterm tile split`/`niwaterm tab new`で`--cwd`省略時、分割元・対象タイルのアクティブタブのこの値がデフォルトの作業ディレクトリとして使われる。Windows上のWSLプロファイルタブはWindows側から見えるUNC形式へ自動変換される（`src/bun/wsl-cwd.ts`）。**zsh/bash/fishはOSC 7送信に対応、PowerShell版シェル統合は現時点でブランチ通知のみ**。OSC 7自体はlibghostty-vt側に制約は無く、niwaterm.ps1へのOSC 7送信追加は今後の対応として残っている。

同スクリプトはプロンプトの位置もOSC 133（セマンティックプロンプト）で通知する。これもlibghostty-vtのネイティブ機能で、niwatermの[プロンプトジャンプ](/guide/config.md)（prefix + `shift+up` / `shift+down`、コピーモードの `{` / `}`）がこのマークを辿る。zsh/fishはプロンプト開始（A）とコマンド実行開始（C）の両方を、bashはPS0が使える4.4以降で両方（3.2ではAのみ）、PowerShellはPSReadLineの`PSConsoleHostReadLine`を包んで両方を送る。starship等が自前でOSC 133を出す環境で二重に送られても、同じ行に同じマークが付くだけで実害は無い。

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

`agent setup`でCodex CLIまたはClaude Codeのhooksを導入する。アプリの起動は不要。

```sh
niwaterm agent setup <codex-cli|claude-code> [--config <path>] [--cli <niwaterm|niwaterm-dev>]

niwaterm agent setup codex-cli
niwaterm agent setup claude-code
niwaterm-dev agent setup codex-cli
```

既定の設定先はCodexが`$CODEX_HOME/hooks.json`（未設定なら`~/.codex/hooks.json`）、Claude Codeが`$CLAUDE_CONFIG_DIR/settings.json`（未設定なら`~/.claude/settings.json`）。プロジェクト単位など別のJSONへ書く場合は`--config`で指定する。
既存の他ツールの設定を保持し、niwatermのhooksだけを追加・更新する。変更前のファイルは同じディレクトリの`*.niwaterm-<ID>.bak`へ保存する。再実行しても重複せず、設定のJSONが不正な場合は書き換えない。

hooksに登録するCLI名は`NIWATERM_APP_VARIANT=niwaterm-wip`なら`niwaterm-dev`、それ以外なら`niwaterm`。`--cli`で明示もできる。
Codexは導入後に`/hooks`で設定を確認して信頼し、再起動する。Claude Codeも再起動する。
複数の設定元に重複して導入しない。Codexの`config.toml`に埋め込んだniwaterm用hooksはこのコマンドでは変更しないため、別途整理する。

内部コマンド`niwaterm _hook <codex-cli|claude-code>`は通常のヘルプには表示しない。エージェントのJSON入力から、タブ変数`agent`（種別）・`agent_status`（`idle` / `working` / `blocked`）・`agent_status_text`（要約）・`agent_transcript`（会話記録ファイルのパス）を更新する。`agent_transcript`はパスが変わらないので、セッション開始とプロンプト送信のときだけ書き込む（入力に会話記録のパスを渡さないエージェントでは書き込まない）。
`NIWATERM_TAB_ID`がない環境では何もせず、不正入力や接続失敗でも無出力・終了コード0で終了する。処理の上限は2秒。`jq`は不要で、hook本体の修正はCLIの更新で反映される。購読イベントやCLI名を変えた場合は`agent setup`を再実行する。
配布設定のシェル構文はmacOS・Linux/WSL向け。

サイドバーはBoard内の全タブを走査し、`blocked` > `working` > `idle`の順で状態を表示する。`agent`が空のタブは対象外で、未知の状態値は`idle`扱い。要約は改行をスペースに置換し、Unicodeのコードポイント単位で60文字に切り詰める。
Codexの質問ツールによる入力待ちは`working`のままで、`blocked`は承認要求を表す。並行ツールの状態は最後の書き込みが優先される。

`agent` / `agent_status` / `agent_status_text` / `agent_transcript`は予約キーで、通常のセッション終了時にクリアする。アプリ終了時に保存されても、Board復元では読み込まれない。
エージェント別のイベント対応と導入例は、リポジトリの`contrib/agent-integration/`配下を参照。

`bell`も同じく予約キーで、ターミナルがBEL文字（`0x07`）を出力するとniwatermが`1`をセットし、そのタブが画面に出た時点で自動的に消す（タブバー・サイドバーのベルアイコンの出し分けに使う）。復元で読み込まれない点も`agent`系と同じ。挙動の変更は設定ファイル側（`niwa.on("bell", ...)`、docs/guide/config.md「ベル」参照）で行う。

## Claude Codeのセッション参照

```sh
niwaterm claude prompt list [--tab <tabId>] [--transcript <path>] [--json] [--label <chars>]
niwaterm claude prompt show [--prompt <index|uuid>] [--tab <tabId>] [--transcript <path>] [--json] [--max-result <chars>] [--sidechain]
```

そのタブで動いているClaude Codeのtranscript（会話記録のjsonl）から、打ったプロンプトの一覧と、
そのプロンプトからのやりとりを読む。

- `claude prompt list` — ユーザーが打ったプロンプトを番号付きで並べる。システムが差し込んだ
  プロンプト（タスク通知等）とサブエージェントの内部やりとりは除く
- `claude prompt show` — 指定したプロンプトから次のプロンプトまでのやりとりを、プロンプト・応答・
  thinking・ツール呼び出し・ツール結果に分けて出す。`--prompt`は`list`の番号かuuid（前方一致可）で、
  省略すると最後のプロンプト。ツール結果は1件ずつ文字数で打ち切る（`--max-result`、既定2000）。
  `--sidechain`でサブエージェントのやりとりも含める

**画面ではなくファイルを読む**。Claude Codeはalternate screenで動くため、会話履歴はniwatermの
スクロールバックに残らず、`tab capture`でもプロンプトジャンプでも辿れない
（docs/known-issues/claude-code-history-not-in-scrollback.md）。裏返しの利点として、
コンテキスト圧縮で画面から消えたやりとりも読める。

transcriptの場所は、[エージェント統合](#エージェント統合)のhooksがタブ変数`agent_transcript`へ
書き込んだものを使う。hooksを入れていないタブでは`--transcript`でjsonlのパスを直接渡す。
`--json`は設定ファイルやAIエージェントからパースする用で、`list`はプロンプトの配列、
`show`は`{prompt, blocks}`を出す。

タブの端に目次を出して、クリックしたプロンプトへClaude Code側の表示を移す例が
`contrib/agent-integration/claude-code/prompt-jump/`にある。

```sh
niwaterm browser navigate --tab <tabId> --url <url>
niwaterm browser get-text --tab <tabId>
niwaterm browser get-html --tab <tabId>
niwaterm browser screenshot --tab <tabId> --out <path>
niwaterm tab focus [--tab <tabId>]
```

ブラウザタブをCLIから操作するコマンド（PlaywrightのAPIのような感覚での操作を想定。読み取り中心のMVPで、click/fill等の操作系は未対応）。

- `browser navigate` — 指定したブラウザタブのURLを遷移する（Playwrightの`page.goto()`相当）。次のページ読み込み完了まで待って結果を返す
- `browser get-text` — 指定したブラウザタブの表示内容をプレーンテキストで取得する（`document.body.innerText`相当）
- `browser get-html` — 指定したブラウザタブのHTMLを取得する（`document.documentElement.outerHTML`相当）
- `browser screenshot` — 指定したブラウザタブの現在URLをheadlessブラウザ（Bun本体がv1.3.12以降ネイティブに提供する`Bun.WebView`、macOSはniwatermのElectrobun側と同じWKWebViewベース）で別途開き直し、スクリーンショットをPNGファイルに保存する。**表示中タブそのものではなく、別インスタンスで同じURLを新規に開いた場合の見た目**になる点に注意（ログイン状態やスクロール位置、フォーム入力中の値などは反映されない）

対象`tabId`がterminalタブの場合、または存在しない場合は、いずれもエラーメッセージと共に終了コード1を返す。対象タブの所属ワークスペースが非アクティブ（他のワークスペースを表示中）な場合もエラーになる。その場合は先に`tab focus`で対象ワークスペースをアクティブ化してから呼び直す。

- `tab focus` — 指定したタブが属するワークスペース・タイルへ切り替え、そのタブをアクティブ化し、ウィンドウを前面化する。**AIが普段ヘッドレスでブラウザタブを操作しつつ、人間が確認したい時に任意でその画面を見られるようにするためのコマンド**。`tab switch`/`tile focus`と役割が重なって見えるが、粒度が異なる合成コマンドである:
  - `tab switch --tile --tab`（または`--direction`） — 同一タイル内でのアクティブタブ切替のみ（ワークスペース非依存、ウィンドウ前面化なし）
  - `tile focus --tile` — フォーカス（キー入力の宛先）を移すのみ
  - `tab focus --tab` — `tabId`だけを渡せば、内部でワークスペース切替・タイルフォーカス・タブアクティブ化・ウィンドウ前面化までを代行する

「表示中タブそのものの見た目を確認したい」場合は、`tab focus`で実ウィンドウを前面化して直接目視するか、`browser screenshot`で同じURLのheadlessスクショを撮る。後者はDOM状態が再現されない代わりに、人間が画面の前にいなくても確認できる。使い分けの目安として、両者は互いを置き換えるものではない。

```sh
niwaterm --help
niwaterm ping --help
```

```sh
niwaterm docs list [--json]
niwaterm docs show <name>
```

`niwaterm docs list`は利用可能なドキュメントトピックを`name<TAB>description`形式で表示する。`--json`を付けると、トピックの配列と次の操作を示す`help`を持つJSONで出力する。`niwaterm docs show <name>`はそのトピックのドキュメントそのものをターミナルへ出力する。リポジトリを直接読めない状況（AIエージェントがCLI経由でniwatermを操作する場合など）でも、CLIだけでドキュメント全体を取得できる。

トピックは`docs/guide/`配下のMarkdownから組み立てられ、`name`は拡張子を除いたファイル名、説明はfrontmatterの`description`をそのまま使う。guideを増やせば一覧にも載るため、CLI側にトピックを登録する必要はない。

## コマンド命名規則

コマンドを追加する際の命名ルールは`.agents/rules/cli-command-naming.md`を参照。

## AIエージェント向けの導線

- `packages/cli/README.md` — CLIパッケージのセットアップ手順・基本的な使い方
- `.agents/skills/niwaterm-cli/SKILL.md` — Claude Codeなどのエージェントがniwatermを操作する際に自律的に発見できるスキル定義

いずれもコマンドの詳細はこのドキュメント（`niwaterm docs show cli`）への導線に留め、内容を書き写さない。

エージェントはコマンドを予測できない順序で叩くため、`docs`コマンドへの導線は入口ごとに出す。

- `--version` — バージョン文字列をパースする側を壊さないよう、導線だけstderrへ出す
- `--help` — フッターに出す。サブコマンドのヘルプにも同じものが付く
- 失敗時のエラー出力 — AIエージェントからの実行と判定できたときだけ出す。人間の実行では毎回のノイズになるため

エージェントかどうかはgunshiの`getAgentProfile()`（`AI_AGENT`・`CLAUDECODE`等の環境変数を見る）で判定する。

導線に埋め込むコマンド名は`NIWATERM_CLI_NAME`で変えられる。開発用の`niwaterm-dev`は`exec bun <エントリ>`の形のラッパーで起動名が残らず、既定の`niwaterm`のまま案内すると常用インスタンス側のCLIへ誘導してしまうため、ラッパー側でこの変数を渡している。

## スコープ外（roadmap参照）

- npm registryへの公開・実行可能ファイルとしての配布
