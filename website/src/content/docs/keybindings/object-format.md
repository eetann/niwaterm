---
title: オブジェクト形式のキーバインド
description: キーバインドを関数ではなくオブジェクトで書く従来の形式
---

`keybindings`に次の4フィールドを持つオブジェクトを直接渡すこともできる。未指定のフィールドは`defaultKeybindings`の値のまま有効（`defaultKeybindings`をspreadしてから一部だけ上書きするのが基本の書き方）。

| フィールド        | 型                                                                                      | 意味                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prefix`          | `KeyBindingString`                                                                      | prefixキー本体。既定は`"ctrl+b"`（tmux標準を踏襲。macOS/Windowsで共通）                                                                                                                    |
| `bindings`        | `Record<string, KeybindAction \| { target: KeybindAction, repeat: boolean }>`           | prefix入力後に押す2打目キー→アクションのマップ。`{ target, repeat: true }`の形で指定するとrepeat連打が有効になる（[「repeatによる連打」](/niwaterm/keybindings/#repeatによる連打)参照）    |
| `direct`          | `Record<KeyBindingString, KeybindAction \| { target: KeybindAction, repeat: boolean }>` | prefixを介さず即座に発火する直接ショートカット。既定はWindowsのみコピー・ペーストが入っている（macOSはApplicationMenu経由でCmd+C/Vが既に機能するため空）。`repeat`はここでは効果を持たない |
| `repeatTimeoutMs` | `number`                                                                                | `repeat: true`なバインドが連打とみなす間隔(ms)。既定500                                                                                                                                    |

```ts
keybindings: {
  ...defaultKeybindings,
  bindings: {
    ...defaultKeybindings.bindings,
    d: "split-horizontal",
    "shift+d": "split-vertical",
    h: { target: "resize-left", repeat: true },
  },
},
```

以下、両形式に共通するバインド文字列の書式・既定値・アクション一覧。

**`prefix` / `direct` の書式**: `修飾子+...+キー本体`（`+`区切り）

- 修飾子は `cmd` / `ctrl` / `shift` / `alt`。**`cmd`/`ctrl`/`alt`のいずれかを含む必要がある**（`shift`単独を含め、これらを含まないキーは通常のターミナル入力に予約されているため、割り当てても無視される）
- 例: `"ctrl+b"`, `"cmd+shift+c"`, `"alt+h"`（tmuxの`bind-key -n M-h`相当。Alt単独の組み合わせはシェルのreadlineショートカットや特殊文字入力と衝突しうるので注意）

**`bindings`（2打目キー）の書式**: 修飾子なしの単一キー本体、または`修飾子+キー本体`

- 修飾子は `shift` / `alt` のみ許容（prefix自体で既に主要な修飾子を使っているため、2打目はシンプルな単一キー操作に絞っている。`cmd`/`ctrl`を含むエントリは無視される）
- キー本体はアルファベット（`d`, `w`, `c`等）、矢印（`up`/`down`/`left`/`right`）、`pageup`/`pagedown`/`home`/`end`、角括弧（`[`/`]`）、バッククォート（`` ` ``）のいずれか
- 例: `"d"`, `"shift+d"`, `"up"`, `"pageup"`

**既定の2打目キー一覧**（prefix `ctrl+b` の後に押す）:

| キー                             | アクション                                                |
| -------------------------------- | --------------------------------------------------------- |
| `d` / `shift+d`                  | split-vertical / split-horizontal                         |
| `w`                              | close-tile                                                |
| `up` / `down` / `left` / `right` | focus-up / focus-down / focus-left / focus-right          |
| `z`                              | toggle-zoom                                               |
| `c`                              | new-board                                                 |
| `t`                              | new-tab                                                   |
| `shift+t`                        | new-browser-tab                                           |
| `u`                              | focus-url-bar                                             |
| `n` / `p`                        | next-tab / prev-tab                                       |
| `r`                              | rename-tab                                                |
| `,`                              | rename-board                                              |
| `shift+n`                        | new-workspace                                             |
| `shift+w`                        | new-window                                                |
| `]` / `[`                        | next-workspace / prev-workspace                           |
| `b`                              | toggle-sidebar                                            |
| `shift+b`                        | next-sidebar-view                                         |
| `f`                              | jump-hint                                                 |
| `v`                              | copy-mode                                                 |
| `` ` ``                          | toggle-popup                                              |
| `i`                              | show-config                                               |
| `:`                              | command-palette                                           |
| `=` / `-` / `0`                  | increase-font-size / decrease-font-size / reset-font-size |
| `pageup` / `pagedown`            | scroll-page-up / scroll-page-down                         |
| `home` / `end`                   | scroll-to-top / scroll-to-bottom                          |
| `shift+up` / `shift+down`        | jump-prompt-up / jump-prompt-down                         |

**KeybindAction の一覧**（64種類。関数ベースAPIでは`niwa.keybind(key, "アクション名")`のように文字列そのまま渡せる）:

| アクション                                                   | 意味                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `split-vertical` / `split-horizontal`                        | タイルを垂直/水平分割                                                                                                                                                                                                                                                                                                                                                            |
| `close-tile`                                                 | フォーカス中のタブ/タイルを閉じる                                                                                                                                                                                                                                                                                                                                                |
| `focus-up` / `focus-down` / `focus-left` / `focus-right`     | 隣接タイルへフォーカス移動                                                                                                                                                                                                                                                                                                                                                       |
| `resize-up` / `resize-down` / `resize-left` / `resize-right` | フォーカス中タイルを既定の1ステップ分拡大（`niwa.tile.resize`相当）。既定キーは無いため使うには自分で割り当てる必要がある。`repeat: true`と組み合わせるとtmuxの`-r`風に連打できる（[「repeatによる連打」](/niwaterm/keybindings/#repeatによる連打)参照）                                                                                                                         |
| `toggle-zoom`                                                | フォーカス中タイルの一時的なズーム表示を切り替える（`niwa.tile.zoom()`相当。tmuxの`resize-pane -Z`相当。他のタイルを隠し画面全体に表示、再実行で解除。タブを右クリックして「ズーム表示」／「ズームを解除」を選んでも同じことができる）                                                                                                                                           |
| `new-tab`                                                    | 新規タブ作成（既定は prefix + `t`。ブラウザタブの`shift+t`と対になる）                                                                                                                                                                                                                                                                                                           |
| `new-browser-tab`                                            | 新規ブラウザタブ作成（既定は prefix + `shift+t`。表示URLは`browser.defaultUrl`を参照）。開いた直後はURL欄にフォーカスが入り全選択されるので、URLを打ってEnterするだけで遷移できる（Escapeで元のURLへ戻す）                                                                                                                                                                       |
| `new-custom-view-tab`                                        | `customViews`の先頭のビューを開くタブを作成（`customViews`未設定時は何もしない。既定キーは無いため使うには自分で割り当てる必要がある。ビューを選んで開くにはCLIの`niwaterm tab new --custom-view --view <id>`を使う）                                                                                                                                                            |
| `focus-url-bar`                                              | 表示中のブラウザタブのURL欄へフォーカスし、全選択して打ち替えられる状態にする（既定は prefix + `u`。ブラウザのCmd+L相当だが、`l`をhjklのタイル移動に充てる設定と衝突しないようURLの頭文字にしている。Enterで遷移、Escapeで元のURLへ戻してターミナルへフォーカスを返す。ターミナルタブでは何もしない）                                                                            |
| `next-tab` / `prev-tab`                                      | タブ切替                                                                                                                                                                                                                                                                                                                                                                         |
| `rename-tab`                                                 | フォーカス中タブの名前を入力ダイアログで変更する（既定は prefix + `r`。Enterで確定、Escapeでキャンセル。空のまま確定すると既定の連番ラベルへ戻る。タブバーのタブを右クリックして「名前を変更」を選んでも同じことができる）                                                                                                                                                       |
| `restart-tab`                                                | フォーカス中タブのプロセスを強制終了し、同じ`tabId`のまま再起動する（`niwa.tab.respawn`相当。tmuxの`respawn-pane -k`相当だが既定バインドは無く、実行前にy/nの確認ダイアログを挟む。使うには自分で割り当てる必要がある）                                                                                                                                                          |
| `new-board`                                                  | アクティブなワークスペースにBoardを追加する（既定は prefix + `c`。tmuxの`new-window`相当で、キーも`bind-key c`を踏襲する。CLIの`niwaterm board new`と同じ）。サイドバーのワークスペース見出しを右クリックしても同じことができる                                                                                                                                                  |
| `close-board`                                                | アクティブなBoardを中のタブごと削除する（CLIの`niwaterm board close`と同じ。実行前にy/nの確認ダイアログを挟む。ワークスペースが1つだけのときの最後の1つは閉じられない。サイドバーのBoard行を右クリックしても同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある                                                                                             |
| `next-board` / `prev-board`                                  | 同じワークスペース内のBoard切替（tmuxの`next-window` / `previous-window`相当）。既定キーは無いため使うには自分で割り当てる必要がある                                                                                                                                                                                                                                             |
| `rename-board`                                               | アクティブなBoardの名前を入力ダイアログで変更する（tmuxの`rename-window`相当。既定は prefix + `,`。Enterで確定、Escapeでキャンセル。空のまま確定すると自動で付く名前（[「Board設定」](/niwaterm/boards/#board設定)の`board.naming`）へ戻る。サイドバーのBoard行をダブルクリック・右クリックしても同じことができる）                                                              |
| `set-board-worktree`                                         | アクティブなBoardに紐づくワークツリーを入力ダイアログで設定する（CLIの`niwaterm board worktree set`と同じ。入力欄にはそのBoardのカレントディレクトリが入った状態で開き、空のまま確定すると紐づけを解除する。サイドバーのBoard行を右クリックしても同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある                                                        |
| `set-board-phase`                                            | アクティブなBoardの作業フェーズを、候補（[「Board設定」](/niwaterm/boards/#board設定)の`board.phases`）から選ぶピッカーを開く。色付きの候補が並び、今のフェーズにはチェックが付く。↑↓のほかTab / Shift+Tabでも候補を移動でき、Enterで確定、Escapeでキャンセル。フェーズが付いているBoardでは末尾に「フェーズを解除」も並ぶ。既定キーは無いため使うには自分で割り当てる必要がある |
| `set-board-phase:<id>`                                       | アクティブなBoardに作業フェーズを直接設定する（`<id>`は[「Board設定」](/niwaterm/boards/#board設定)の`board.phases`のid）。ピッカーを挟まず1打で切り替えたいとき向けで、設定側にしか書けないアクションなので既定キーは無い                                                                                                                                                       |

| `clear-board-phase` | アクティブなBoardの作業フェーズを解除する（既定キーは無いため使うには自分で割り当てる必要がある） |
| `clear-board-startup` | アクティブなBoardの起動時レイアウトの紐づけを解除する（CLIの`niwaterm board startup clear`と同じ。今のレイアウトはそのまま残り、次回起動時は保存した骨格を復元する既定の挙動に戻る。サイドバーのBoard行を右クリック →「起動時レイアウト」からも同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `new-workspace` | 新規ワークスペース作成 |
| `rename-workspace` | アクティブなワークスペースの名前を入力ダイアログで変更する（`rename-board`と同じ操作感で、空のまま確定すると既定の連番ラベルへ戻る。サイドバーの見出しをダブルクリック・右クリックしても同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `close-workspace` | アクティブなワークスペースを中のBoardごと削除する（CLIの`niwaterm workspace close`と同じ。実行前にy/nの確認ダイアログを挟む。最後の1つは閉じられない。サイドバーの見出しを右クリックしても同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `new-window` | 新しいOSウィンドウを開く（既定は prefix + `shift+w`。CLIの`niwaterm window new`と同じ。前回の状態は復元されず、閉じても何も残らない一時ウィンドウになる。詳細は[CLIからの操作](/niwaterm/cli/)） |
| `close-window` | このniwatermのOSウィンドウを閉じる（CLIの`niwaterm window close`と同じ。中のPTYはすべて終了するため実行前にy/nの確認ダイアログを挟む。最後の1枚を閉じるとniwaterm自体が終了する）。既定キーは無いため使うには自分で割り当てる必要がある |
| `next-workspace` / `prev-workspace` | ワークスペース切替 |
| `move-board-up` / `move-board-down` | アクティブなBoardの表示順をワークスペース内で1つ上/下へ移動する（サイドバーのドラッグ&ドロップ、CLIの`niwaterm board move --up/--down`と同じ並び替え）。端では何もしない。既定キーは無いため使うには自分で割り当てる必要がある |
| `move-board-to-workspace` | アクティブなBoardを別のワークスペースへ移す（tmuxの`move-window`相当。CLIの`niwaterm board move --to-workspace`と同じ）。移動先はピッカーで選ぶ（Escapeでキャンセル）。移すとワークスペースが空になる場合は確認ダイアログを挟む。既定キーは無いため使うには自分で割り当てる必要がある |
| `move-workspace-up` / `move-workspace-down` | アクティブなワークスペースの表示順を1つ上/下へ移動する（サイドバーのドラッグ&ドロップ、CLIの`niwaterm workspace move`と同じ並び替え）。端では何もしない。既定キーは無いため使うには自分で割り当てる必要がある |
| `toggle-sidebar` | サイドバーの表示/非表示切替 |
| `next-sidebar-view` / `prev-sidebar-view` | サイドバーに出すビュー（ワークスペース一覧と各`customViews`パネル）を循環で切り替える（既定はnext側のみ prefix + `shift+b`。ビューが2つの間はnextだけで往復できるため、prevを使うには自分で割り当てる必要がある。`customViews`未設定時はビューが1つしかないので何もしない。サイドバーを閉じている場合は開いた上で切り替える） |
| `show-sidebar-view:<id>` | サイドバーに出すビューをidで直接指定する（`<id>`は`customViews`のidか、ワークスペース一覧の`workspaces`。ビューが増えたときに循環で辿らず1打で届かせるためのもの。既定キーは無いため使うには自分で割り当てる必要がある。サイドバーを閉じている場合は開いた上で切り替える） |
| `toggle-status-bar` | ステータスバーの表示/非表示切替（CLIの`niwaterm status-bar toggle`と同じ）。全ウィンドウへ同時に反映し、次回起動時にも引き継ぐ。`statusBar: false`の場合は何もしない。既定キーは無いため使うには自分で割り当てる必要がある |
| `refresh-status-bar` | ステータスバーの部品を全ウィンドウで評価し直す（CLIの`niwaterm status-bar refresh`と同じ）。既定キーは無いため使うには自分で割り当てる必要がある |
| `toggle-popup` | ポップアップの表示/非表示切替 |
| `promote-popup` | 開いているポップアップの中身を、フォーカス中タイルへ通常タブとして編入する（CLIの`niwaterm popup promote`と同じでPTYは維持される。ポップアップのツールバーの↑ボタンでも同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `jump-hint` | ジャンプ先へラベルを出し、打ったラベルの場所へ飛ぶ（既定は prefix + `f`。vimiumの`f`相当。操作は[「ジャンプヒント」](/niwaterm/jump-and-copy/#ジャンプヒント)参照） |
| `copy-selection` | 選択範囲をクリップボードへコピー（既定は`direct`にWindowsのみ`ctrl+shift+c`が割り当て済み。macOSはApplicationMenu経由でCmd+Cが既に機能する） |
| `copy-mode` | vi風コピーモードに入る（既定は prefix + `v`。キーボードだけでスクロールバックを移動・選択・コピーできる。操作キーは[「コピーモード」節](/niwaterm/jump-and-copy/#コピーモードvi風のキーボード選択)参照） |
| `paste-clipboard` | クリップボードの内容をペースト（既定は`direct`にWindowsのみ`ctrl+shift+v`が割り当て済み。macOSはApplicationMenu経由でCmd+Vが既に機能する） |
| `scroll-page-up` / `scroll-page-down` | スクロールバックを1ページ分スクロール |
| `scroll-to-top` / `scroll-to-bottom` | スクロールバックの先頭/最新行へジャンプ |
| `jump-prompt-up` / `jump-prompt-down` | 1つ前/次のシェルプロンプトへジャンプする（既定は prefix + `shift+up` / `shift+down`。見つけたプロンプト行が画面の一番上に来るようスクロールするので、そのコマンドの出力を頭から読める。[「プロンプトジャンプ」節](/niwaterm/jump-and-copy/#プロンプトジャンプコマンド単位で遡る)参照） |
| `command-palette` | コマンドパレットを開く（既定は prefix + `:`。この表のアクションに加えて、シェルプロファイルごとの`New Tab: <名前>`と、名前で選んで飛べる`Switch to Board: <名前>`・`Switch to Workspace: <名前>`も並ぶ。後者はワークスペースをまたいで全Boardが並ぶため、サイドバーを閉じていても目的のBoardへ届く） |
| `increase-font-size` / `decrease-font-size` / `reset-font-size` | フォントサイズの拡大/縮小/リセット |
| `reload-config` | 設定ファイルを手動で再読み込みする（ファイル保存時の自動リロードと同じ処理。既定キーは無いため使うには自分で割り当てる必要がある） |
| `show-config` | 現在有効な設定値の一覧をモーダルで表示する（既定は prefix + `i`。CLIの`niwaterm config show`と同じ内容。Escapeで閉じる） |
| `quit-app` | niwaterm自体を終了する（すべてのウィンドウが閉じ、中のPTYはすべて終了する。レイアウトはOSのCmd+Q・×ボタンで閉じたときと同じように保存され、次回起動時に復元される）。取り返しのつかない操作のため実行前にy/nの確認ダイアログを挟み、コマンドパレットでも警告アイコン付き（「アプリ」カテゴリの`Quit niwaterm`）で並ぶ。既定キーは無いため使うには自分で割り当てる必要がある |
