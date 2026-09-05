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

`~/.config/niwaterm/`に`package.json`/`tsconfig.json`/`niwaterm.config.ts`の3ファイルを生成し（`packages/config/examples/`が実体）、`bun install`まで実行する。`package.json`の`@niwaterm/config`依存はこのリポジトリの`packages/config`への絶対パスで自動的に埋まる。既存ファイルは上書きしない（実行済みディレクトリへ再実行しても安全）。依存インストールを飛ばしたい場合は`--skip-install`を付ける。設定ファイルの書き方の詳細は`docs/guide/config.md`参照。

## 使い方

```sh
niwaterm ping
```

niwatermアプリが起動していれば`pong (pid <アプリのpid>)`が返る（終了コード0）。アプリが起動していない、またはIPCサーバーに接続できない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm list
```

ワークスペース→Board→タイル→タブの階層構造を表示する。Boardが1つのみのワークスペースはBoard行を省略する（ADR 0006、サイドバー表示と同じ方針）。アクティブなワークスペース/Board/フォーカス中タイル/アクティブタブにはそれぞれ`(active)`/`(active)`/`(focused)`/`(active)`のサフィックスが付く。`tab send-keys`で指定するtabIdはここで確認する。

レイアウトプリセットが紐づいているBoardには`[startup: <name>]`（起動時にそのプリセットで組み直す）または`[preset: <name>]`（プリセット名は覚えているが起動時は骨格を復元する）が付く（「起動時レイアウト」節）。この表示を確認できるよう、紐づけのあるBoardはワークスペース内に1つしか無くてもBoard行を省略しない。

```sh
niwaterm notify --title <title> [--body <body>] [--subtitle <subtitle>] [--silent]
```

OSのデスクトップ通知を出す。AIエージェントがタスク完了等をユーザーへ知らせる用途を想定（`--title`のみ必須）。クリックしてもniwatermへのフォーカス移動は行わない。Windows実機ではElectrobun本体の通知APIが機能しない既知の不具合があり、PowerShell経由の代替実装を使っている（詳細: `docs/known-issues/windows-shell-notifyicon-not-registered.md`）。

```sh
niwaterm tab send-keys --tab <tabId> <keys...>
```

指定したタブへキーを送信する（tmuxの`send-keys`相当）。`<keys...>`にはリテラル文字列と特殊キー名を複数個並べて混在指定できる。

```sh
niwaterm tab send-keys --tab tab-3 'ls -la' Enter
niwaterm tab send-keys -t tab-3 C-c
```

対応する特殊キー名: `Enter`, `Escape`, `Tab`, `Space`, `BSpace`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `Delete`, `PageUp`, `PageDown`。`C-a`〜`C-z`（英字のみ）でCtrl修飾も送れる。上記以外の文字列はリテラルとしてそのままPTYへ送信される。指定したtabIdが存在しない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm tile split [--tile <tileId>] [--orientation horizontal|vertical] [--cwd <dir>]
niwaterm tab new [--tile <tileId>] [--url <url> | --custom-view | [--shell <shellProfileId>] [--cwd <dir>]]
niwaterm tab switch [--tile <tileId>] --tab <tabId>
niwaterm tab close [--tile <tileId>] [--tab <tabId>]
niwaterm tab respawn [--tab <tabId>] [--shell <shellProfileId>] [--cwd <dir>] [--command <cmd>]
niwaterm tile focus [--tile <tileId>]
niwaterm tile focus --direction up|down|left|right
niwaterm tile resize [--tile <tileId>] --direction up|down|left|right [--amount <0より大きく1以下>]
niwaterm tile zoom [--tile <tileId>]
```

レイアウト操作コマンド。いずれも対象の`tileId`/`tabId`は`niwaterm list`で確認する。`--tile`/`--tab`を省略した場合の対象は「対象IDの省略」節を参照。

- `tile split` — 指定タイルを分割する（`--orientation`省略時は`vertical`）。`--cwd`省略時は分割対象タイルのアクティブタブが実際にいるディレクトリ（下記「シェル統合」参照。不明ならOS標準）を新規タブの作業ディレクトリに使う。成功時、新規に作られた`tileId`/`tabId`を表示する
- `tab new` — 指定タイルに新規タブを作成する。`--url`指定時はそのURLを開くブラウザタブ、`--custom-view`指定時は`niwaterm.config.ts`の`customView`設定を開くブラウザタブ、`--shell`指定時はそのシェルプロファイル（idは`niwaterm shell-profiles`で確認）でターミナルタブ、いずれも省略時はデフォルトシェルの通常のターミナルタブを作成する（`--url`・`--custom-view`・`--shell`は互いに同時指定不可）。`--cwd`で作業ディレクトリを指定できる（ターミナルタブ専用。`--shell`とは併用可、`--url`・`--custom-view`とは同時指定不可）。`--cwd`省略時は`tile split`と同様、対象タイルのアクティブタブが実際にいるディレクトリを使う。成功時、新規`tabId`を表示する
- `tab switch` — 指定タイル内でアクティブタブを切り替える。`--tile`省略時は`--tab`のタブが属するタイル
- `tab close` — 指定タブを閉じる（tmuxの`kill-window`相当）。ワークスペース最後の1枚のタイルの最後のタブは誤操作防止のため閉じられない。引数を全て省略すると実行しているタブ自身が閉じる
- `tab respawn` — 指定タブのプロセスを強制終了し、同じ`tabId`・タイル位置のまま再起動する（tmuxの`respawn-pane -k`相当、対象がブラウザタブの場合は失敗する）。`--shell`省略時はデフォルトシェル、`--cwd`省略時は元のタブが実際にいるディレクトリを引き継ぐ。`--command`を指定すると、シェルの代わりにそのコマンドを実行する（`popup open`の位置引数と同じ意味のワンショット実行）。GUIのキーバインドからこの操作を割り当てた場合は実行前にy/nの確認ダイアログを挟むが、CLIからの実行に確認は無い
- `tile focus` — タイルへフォーカスを移す。`--tile`（直接指定）と`--direction`（現在フォーカス中のタイルから見て指定方向にある最も近いタイルへ移動。該当タイルが無ければ何もしない、エラーにはならない。常にアクティブなワークスペース基準で動く）はどちらか一方のみ指定できる。どちらも省略すると実行しているタブのタイルへフォーカスを移す（背面のタブから自分を前に出す用途）
- `tile resize` — 指定タイルを指定方向へ拡大する（tmuxの`resize-pane`相当）。`--amount`省略時は既定の1ステップ分。`--direction`の軸に一致するsplitが祖先に無い場合（単一タイルのワークスペース等）は失敗する
- `tile zoom` — 指定タイルの一時的なズーム表示を切り替える（tmuxの`resize-pane -Z`相当）。他のタイルを隠して画面全体に表示し、再度実行すると解除する。ズーム中のタイルを分割する、または他のタイルへフォーカスを移すと自動的に解除される

いずれも対象の`tileId`/`tabId`が存在しない場合はエラーメッセージと共に終了コード1を返す。

```sh
niwaterm popup open [--cwd <dir>] [--width <1-100>] [--height <1-100>] [--wait] [--capture-stdout] [command...]
```

タイル・タブに所属しない一時的なポップアップ画面を開く（tmuxの`popup`/`floating`相当。設計判断の詳細: `docs/adr/0005-adopt-workspace-scoped-single-popup.md`）。アクティブなワークスペースにつき最大1つだけ開ける。`--cwd`省略時はフォーカス中タイルのアクティブタブが実際にいるディレクトリを使う。`--width`/`--height`は表示サイズ（1〜100のパーセント、省略時は既定値）。`command...`を指定すると、デフォルトシェル（WSLプロファイル等も含む）の`-c`/`-Command`相当でそのコマンドを実行し（例: `niwaterm popup open lazygit`）、コマンドが終了すると自動的にポップアップも閉じる（ワンショット実行。lazygit・nvim等のフルスクリーンTUIでも機能する）。省略時は通常のシェルが起動したままになる。成功時、新規`tabId`を表示する。

表示/非表示の切り替えはキーバインド（既定: prefix `ctrl+b` → `` ` ``、macOS/Windows共通）でも行える。GUIでは`popup-box`右上のツールバーからも操作できる。ポップアップが既に開いている場合、このコマンドはエラーメッセージと共に終了コード1を返す。

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

```sh
niwaterm board new [--workspace <workspaceId>] [--cwd <dir>]
niwaterm board switch --board <boardId>
niwaterm board close [--board <boardId>]
niwaterm board rename [--board <boardId>] <name>
niwaterm board move [--board <boardId>] --up | --down
niwaterm board startup layout|restore|clear [--board <boardId>] [--preset <name>] [--cwd <dir>] [--trust]
```

Board（1つのワークスペース内で複数持てる独立したTileレイアウト。tmuxのWindow相当、詳細: `docs/adr/0006-adopt-board-layer-between-workspace-and-tile.md`）単位の操作コマンド。対象の`boardId`は`niwaterm list`（複数Board時のみBoard行が表示される）または`board new`実行時に表示される値で確認する。

- `board new` — 新規Boardを作成し、アクティブにする。`--workspace`省略時は現在アクティブなワークスペースに作成する。`--cwd`は最初のタブの作業ディレクトリ（省略時はOS標準）。成功時、新規`boardId`を表示する
- `board switch` — 指定したBoardへ切り替える
- `board close` — 指定したBoardを閉じる。ワークスペース内最後の1つのBoardは誤操作防止のため閉じられない。`--board`省略時は実行しているタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）
- `board rename` — 指定したBoardの名前を変更する。`<name>`に空文字列を指定するとデフォルトの連番ラベルへ戻る。`--board`の省略時の扱いは`board close`と同じ
- `board move` — 所属ワークスペース内での表示順（サイドバーの並び・名前未設定時の連番ラベル）を1つ上（`--up`）または1つ下（`--down`）へ移動する。`--up`/`--down`はどちらか一方が必須。中身（タイル・タブ）とアクティブなBoardは変わらず、別のワークスペースへは移らない。既に端にいて動かせない場合は何もせず成功扱いになる。並び順は名前同様アプリ再起動をまたいでも復元される（離れた位置へまとめて動かしたい場合はサイドバーのドラッグ&ドロップ、または設定ファイルの`niwa.board.move(boardId, index)`を使う）
- `board startup` — そのBoardを次回起動時にどう組み直すかを設定する（`--board`省略時は現在アクティブなBoard）。「起動時レイアウト」節を参照

いずれも対象の`boardId`（`board new`は`workspaceId`）が存在しない場合、`board close`はさらにワークスペース内最後の1つを指定した場合もエラーメッセージと共に終了コード1を返す。

```sh
niwaterm layout list [--cwd <dir>]
niwaterm layout apply <name> [--replace | --replace-force] [--board <boardId>] [--workspace <workspaceId>] [--cwd <dir>] [--startup] [--trust]
```

`niwaterm.config.ts`の`layouts`（詳細: `docs/guide/config.md`「レイアウト」節）とプロジェクトローカルの`.niwaterm/config.ts`（「プロジェクトローカルのレイアウト」節）で定義したプリセットを一覧・適用する（[vde-layout](https://github.com/yuki-yano/vde-layout)ライク）。適用先はBoard単位（ADR 0006、`docs/adr/0006-adopt-board-layer-between-workspace-and-tile.md`）。

- `layout list` — 定義済みプリセットを`name<TAB>解決元<TAB>description`形式で表示する。解決元は`[project: <projectRoot>]`か`[global]`。`--cwd`はプロジェクトローカルのプリセットを探す起点で、省略時は実行したディレクトリ。1件も定義されていない場合はその旨を表示する
- `layout apply <name>` — 指定したプリセットを適用する。デフォルトは新規Boardとして適用し（`--workspace`省略時は現在アクティブなワークスペース配下）、成功時にその`boardId`を表示する。`--replace`は既存Board（`--board`省略時は現在アクティブなBoard）を単一タイルへ畳んでから適用し直す（**既存タブ・PTYは無条件でcloseされる**）。`--replace`は実行前に対象を明示したy/n確認プロンプトを表示する（TTYでない場合は確認できないためエラーで終了する）。`--replace-force`は`--replace`と同じ効果で確認プロンプトを省略する。`--replace`/`--replace-force`と`--workspace`、いずれも未指定時の`--board`は同時指定不可。`--cwd`は各タブの`cwd`未指定時に使う作業ディレクトリで、省略時は`niwaterm layout apply`を実行したディレクトリになる（プロジェクトローカル由来のプリセットでは`--cwd`ではなくプロジェクトルートが基準になる。`--replace`/`--replace-force`時、最初に到達するタイルだけは既存タブを使い回すが、そのタブのPTYも基準cwdで起動し直されるためタイル間でcwdが食い違うことはない）。成功時は`board: <boardId><TAB>preset: <name>`を表示し、プロジェクトローカル由来なら`[project: <projectRoot>]`が付く

指定した`name`が未定義の場合、指定した`workspaceId`/`boardId`が存在しない場合、プリセットの検証に失敗した場合はいずれもエラーメッセージと共に終了コード1を返す（検証失敗の主な原因は`shellProfile`の未知のid、`focus:true`の重複、ratioの範囲外指定等）。検証失敗時はBoardに一切変更を加えない。

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

`board startup <mode>`のmodeは次の3つ。`--preset`を省略すると、そのBoardに既に記録されているプリセット名を（プロジェクトローカル由来ならその解決元ごと）引き継ぐ（一度も`layout apply`していないBoardでは`--preset`が必須）。

- `layout` — 起動時にプリセットで組み直す。保存した骨格は使わないので、前回セッションのタブ名・タブ変数・cwdは持ち込まれず、プリセットの`command`も改めて実行される
- `restore` — 保存した骨格を復元する（既定の挙動）。プリセット名の記録自体は残るので、あとから`layout`へ戻せる
- `clear` — プリセットの紐づけごと解除する

起動時にプリセットが設定から消えていた場合、そのBoardは単一タブのまま残り、デスクトップ通知でその旨を知らせる（骨格は復元されない）。プリセット名を変える際は`board startup`で追随させること。プロジェクトローカル由来の場合は、記録された`projectRoot`が消えている・`.niwaterm/config.ts`からプリセットが消えている場合も同じ扱いになる。

サイドバーのBoard行を右クリック → 「起動時レイアウト」からも設定できる。**プリセットを選ぶとその場でBoardへ適用し、同時に起動時レイアウトとしても紐づける**（`layout apply <name> --replace --startup --board <boardId>`と同じ）。次回の起動を待たずに結果が見えるので、意図と違うプリセットを選んだことにその場で気づける。既存タブ・PTYを閉じる破壊的操作なので確認ダイアログが出る（プロジェクトローカル由来なら、その中でtrustの確認文も併せて示される）。「紐づけを解除」は`board startup clear`にあたる。

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

- **CLI・API実行時**（`layout list` / `layout apply` / `board startup --preset`） — 実行したディレクトリ（`--cwd`）から上向きに`.niwaterm/`を探す。見つからない場合はgitのメインワークツリー側の`.niwaterm/`も見る（リンクされたワークツリーに`.niwaterm/`をコミットしていない運用のため）
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

```sh
niwaterm font-size increase|decrease|reset
```

ターミナルのフォントサイズを1段階拡大・縮小、またはconfigファイル（`niwaterm.config.ts`の`appearance.fontSize`）の値へリセットする。上限・下限でクランプされる。`niwaterm.config.ts`自体は変更しない実行時のみのズームで、キーバインド（既定: prefix `ctrl+b` → `=`/`-`/`0`）・コマンドパレットからの操作とも共有される。成功時、変更後のフォントサイズをpx単位で表示する。

```sh
niwaterm shell-profiles
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

## 対象IDの省略

多くのコマンドは`--tile`/`--tab`/`--board`/`--workspace`を省略でき、その場合は**そのコマンドを実行しているタブ**が対象になる。niwatermが起動したシェルには`NIWATERM_TAB_ID`環境変数が入っており、CLIはそれを起点に所属タイル・Board・ワークスペースを解決する。niwatermの外（普通のターミナル・スクリプト）から実行した場合は、アクティブなワークスペース→アクティブなBoard→フォーカス中タイル→そのアクティブタブへフォールバックする（tmuxの`current-pane`相当）。

明示指定した値がこの解決結果で上書きされることはない。存在しないIDを渡しても別の対象へすり替わらず、そのままエラーになる。`--tab`だけを指定して`--tile`を省略した場合は、実行元ではなく**指定したタブが属するタイル**が埋まる（`tab close --tab <tabId>`のような使い方ができる）。

省略できないのは、自分自身を指しても意味が無い切り替え系（`tab switch --tab`、`board switch --board`、`workspace switch --workspace`）、誤送信を避けたい`tab send-keys --tab`、対象がブラウザタブに限られる`browser *`の`--tab`。`tab var`系の`--tab`は`NIWATERM_TAB_ID`のみを見て、フォーカス中タブへのフォールバックは行わない（シェル統合・エージェント統合のhookがniwaterm外で暴発しないようにするため）。

## シェル統合

`contrib/shell-integration/`配下のスクリプトをシェルの起動時にsourceすると、プロンプト表示のたびに現在のgitブランチをタブ変数`branch`へ自動反映する（`niwaterm tab var set branch <branch>`相当を内部で呼ぶ）。サイドバーのタブ行にブランチ名が表示されるようになる。zsh/bash/fish/PowerShellに対応している。

同スクリプトはカレントディレクトリもOSC 7（`kitty-shell-cwd://`スキーム）で通知し、タブ変数`cwd`へ自動反映する（`niwaterm tab var set`のCLI呼び出しは経由しない、ターミナルのネイティブ機能）。libghostty-vt（vt-only版）はURIを未パースのまま返す仕様のため、パスのデコードはniwaterm側（`src/bun/pwd-report.ts`）で行っている。ホスト名検証はしていない。ghostty本家はSSH越しの偽装対策としてホスト名を検証する。niwatermはWSLディストロをシェルプロファイルとして正式サポートしており、その場合シェル側とniwaterm本体側のホスト名は常に不一致になるため、意図的に検証を省いている。`niwaterm tile split`/`niwaterm tab new`で`--cwd`省略時、分割元・対象タイルのアクティブタブのこの値がデフォルトの作業ディレクトリとして使われる。Windows上のWSLプロファイルタブはWindows側から見えるUNC形式へ自動変換される（`src/bun/wsl-cwd.ts`）。**zsh/bash/fishはOSC 7送信に対応、PowerShell版シェル統合は現時点でブランチ通知のみ**。OSC 7自体はlibghostty-vt側に制約は無く、niwaterm.ps1へのOSC 7送信追加は今後の対応として残っている。

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

`contrib/agent-integration/`配下の設定を導入すると、タブ内で動くAIエージェント（Claude Code等）のhooks機構から、そのセッションの状態（idle/working/blocked）をタブ変数`agent`/`agent_status`へ自動反映する。内部では`niwaterm tab var set agent_status working`相当を呼んでいる。サイドバーのBoard行に状態ドットが表示されるようになる。Board行はTile/Tabを畳んだ1行なので、Board内の全タブ（フォーカスしていないタイル・非アクティブタブを含む）を走査し、`blocked` > `working` > `idle`の順で最も目立つ状態を1つ表示する。

なお、**hooksは`~/.claude/settings.json`等へコピーして使う仕組みのため、niwaterm側のCLIコマンド名が変わってもインストール済みの設定は自動追従しない**。hookコマンドは`>/dev/null 2>&1`で出力を捨てるので、コマンド名がずれると`Command not found`が握り潰され「サイドバーに何も出ない」という症状だけが残る。表示されなくなったら、まず`contrib/agent-integration/claude-code/hooks.json`との差分を確認する。

```sh
# 既存のhooks設定を壊さずにマージする。niwaterm由来のエントリ（コマンドに$NIWATERM_TAB_IDを含むもの）
# だけを入れ替え、同じイベントに刺さっている他ツールのhookはそのまま残す。
# jqの `*` で丸ごとマージするとイベント単位で配列ごと置き換わり、他ツールのhookが消えるので使わない
cp ~/.claude/settings.json ~/.claude/settings.json.bak
jq -s '
  def isNiwa: (.hooks // []) | any((.command // "") | test("NIWATERM_TAB_ID"));
  .[0] as $cur | .[1] as $new
  | $cur
  | .hooks = (
      reduce ($new.hooks | to_entries[]) as $e (
        ($cur.hooks // {});
        .[$e.key] = (((.[$e.key] // []) | map(select(isNiwa | not))) + $e.value)
      )
    )
' ~/.claude/settings.json /path/to/niwaterm/contrib/agent-integration/claude-code/hooks.json > /tmp/merged-settings.json
mv /tmp/merged-settings.json ~/.claude/settings.json
```

`branch`と同様、`agent`/`agent_status`もタブ変数の予約キーである（値は`niwaterm tab var set`で自由に読み書きできる汎用キーだが、この2つの名前はサイドバー表示用に予約されている）。`agent`はエージェントの種別を表す任意の文字列（Claude Codeは`claude-code`固定）、`agent_status`は`idle`/`working`/`blocked`のいずれか（未設定・未知の値は`idle`扱い）。各hookコマンドは`$NIWATERM_TAB_ID`が無い環境（niwaterm外のプロジェクト・ターミナル）では何もしないガードが入っているため、グローバル設定に追加しても安全（詳細: `contrib/agent-integration/README.md`）。Claude Code以外のエージェントを対応させる場合の規約も同READMEに記載している。

`agent`/`agent_status`/`agent_status_text`は他のタブ変数と違い、アプリ終了時に保存されても起動時のBoard復元では読み込まれない。復元後のタブに前回のエージェントプロセスは居ないため、残すと実在しない「応答待ち」がサイドバーに出続けてしまう。

```sh
niwaterm browser navigate --tab <tabId> --url <url>
niwaterm browser get-text --tab <tabId>
niwaterm browser get-html --tab <tabId>
niwaterm browser screenshot --tab <tabId> --out <path>
niwaterm tab show [--tab <tabId>]
```

ブラウザタブをCLIから操作するコマンド（PlaywrightのAPIのような感覚での操作を想定。読み取り中心のMVPで、click/fill等の操作系は未対応）。

- `browser navigate` — 指定したブラウザタブのURLを遷移する（Playwrightの`page.goto()`相当）。次のページ読み込み完了まで待って結果を返す
- `browser get-text` — 指定したブラウザタブの表示内容をプレーンテキストで取得する（`document.body.innerText`相当）
- `browser get-html` — 指定したブラウザタブのHTMLを取得する（`document.documentElement.outerHTML`相当）
- `browser screenshot` — 指定したブラウザタブの現在URLをheadlessブラウザ（Bun本体がv1.3.12以降ネイティブに提供する`Bun.WebView`、macOSはniwatermのElectrobun側と同じWKWebViewベース）で別途開き直し、スクリーンショットをPNGファイルに保存する。**表示中タブそのものではなく、別インスタンスで同じURLを新規に開いた場合の見た目**になる点に注意（ログイン状態やスクロール位置、フォーム入力中の値などは反映されない）

対象`tabId`がterminalタブの場合、または存在しない場合は、いずれもエラーメッセージと共に終了コード1を返す。対象タブの所属ワークスペースが非アクティブ（他のワークスペースを表示中）な場合もエラーになる。その場合は先に`tab show`で対象ワークスペースをアクティブ化してから呼び直す。

- `tab show` — 指定したタブが属するワークスペース・タイルへ切り替え、そのタブをアクティブ化し、ウィンドウを前面化する。**AIが普段ヘッドレスでブラウザタブを操作しつつ、人間が確認したい時に任意でその画面を見られるようにするためのコマンド**。`tab switch`/`tile focus`と役割が重なって見えるが、粒度が異なる合成コマンドである:
  - `tab switch --tile --tab` — 同一タイル内でのアクティブタブ切替のみ（ワークスペース非依存、ウィンドウ前面化なし）
  - `tile focus --tile` — フォーカス（キー入力の宛先）を移すのみ
  - `tab show --tab` — `tabId`だけを渡せば、内部でワークスペース切替・タイルフォーカス・タブアクティブ化・ウィンドウ前面化までを代行する

「表示中タブそのものの見た目を確認したい」場合は、`tab show`で実ウィンドウを前面化して直接目視するか、`browser screenshot`で同じURLのheadlessスクショを撮る。後者はDOM状態が再現されない代わりに、人間が画面の前にいなくても確認できる。使い分けの目安として、両者は互いを置き換えるものではない。

```sh
niwaterm --help
niwaterm ping --help
```

```sh
niwaterm docs list
niwaterm docs show cli
```

`niwaterm docs list`は利用可能なドキュメントトピックの一覧、`niwaterm docs show cli`はこのドキュメント（`docs/guide/cli.md`）の内容そのものをターミナルへ出力する。リポジトリを直接読めない状況（AIエージェントがCLI経由でniwatermを操作する場合など）でも、CLIだけでこのドキュメント全体を取得できる。

## コマンド命名規則

コマンドを追加する際の命名ルールは`.claude/rules/cli-command-naming.md`を参照。

## AIエージェント向けの導線

- `packages/cli/README.md` — CLIパッケージのセットアップ手順・基本的な使い方
- `.claude/skills/niwaterm-cli/SKILL.md` — Claude Codeなどのエージェントがniwatermを操作する際に自律的に発見できるスキル定義

いずれもコマンドの詳細はこのドキュメント（`niwaterm docs show cli`）への導線に留め、内容を書き写さない。

## スコープ外（roadmap参照）

- npm registryへの公開・実行可能ファイルとしての配布
