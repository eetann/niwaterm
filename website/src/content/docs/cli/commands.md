---
title: 基本のコマンド
description: ウィンドウ・タブ・ポップアップなどを操作するコマンドのうち、--helpだけでは分かりにくい使い方と挙動
---

ウィンドウ・ワークスペース・Board・タイル・タブ・ポップアップは、CLIからも操作できる。どんなコマンドとオプションがあるかは、`--help`で確かめられる。

```sh
niwa --help
niwa tab --help
niwa tab new --help
```

このページでは、`--help`だけでは分かりにくい使い方と挙動を説明する。特定の機能に関わるコマンドは、その機能のページで説明している（一覧は[CLIからの操作](/niwaterm/cli/)）。

## 今の状態を見る（`list`）

`niwa list`で、今のウィンドウのワークスペース・Board・タイル・タブを階層で表示する。ほかのコマンドに渡すidは、ここで確かめる。

```
workspace-1 "dev" (active)
  tile-1 (focused)
    tab-1 "editor" (active)
    tab-2
  tile-2
    tab-3 "server" (active)
```

名前を付けたものは、idのあとに`"名前"`が出る。今表示しているワークスペース・Board・タブには`(active)`、フォーカス中のタイルには`(focused)`が付く。ブラウザタブにはURL、プログラムが終了したまま残っているタブには`(exited)`が付く。Boardが1つだけのワークスペースでは、サイドバーと同じくBoardの行を省く。

端末で実行すると、名前や状態の印に色が付く。パイプやファイルへ出力したときは色を付けない。環境変数`NO_COLOR`を付けると端末でも色を消せ、`FORCE_COLOR=1`を付けるとパイプでも色を付けられる。

### スクリプトから使う（`--json`）

`niwa list --json`で、同じ内容をJSONで出力する。タブごとに種類（`terminal` / `browser`）・作業ディレクトリ・URL・[タブ変数](#タブ変数tab-var)まで入るので、jqなどで絞り込んで使える。

```sh
# エージェントが応答を待っているタブのidを並べる
niwa list --json | jq -r '.workspaces[].boards[].tabs[] | select(.vars.agent_status == "blocked") | .id'
```

Boardごとに、タイルは`tiles`、タブは`tabs`という1つの配列にまとまっている。分割の形は`layout`に木で入る。キーバインドの関数からは、同じ形を[`niwa.list()`](/niwaterm/keybindings/api/#そのほか)で受け取れる。

**idはniwatermを起動し直すたびに振り直される**。スクリプトにidを書いておいても、次に起動したあとには使えない。決まったタブを探したいときは、[タブ変数](#タブ変数tab-var)で目印を付けておく。

## メインウィンドウと一時ウィンドウ

ウィンドウは2種類ある。

- **メインウィンドウ** — 起動したときに開く1枚。終了したときのワークスペース・Board・タイル・タブと、ウィンドウの大きさ・位置を、次に起動したときに元に戻す
- **一時ウィンドウ** — `niwa window new`やprefix + `shift+w`で開くウィンドウ。何もない状態で開き、閉じると何も残らない。次に起動したときにも戻らない

最後のウィンドウを閉じると、niwatermも終了する。

## キーを送る（`tab send-keys`）

`tab send-keys`で、ほかのタブへ文字やキーを送れる。文字列と特殊キーの名前は、混ぜて並べられる。

```sh
niwa tab send-keys --tab tab-3 'ls -la' Enter
niwa tab send-keys --tab tab-3 C-c
```

使える特殊キーは`Enter`・`Escape`・`Tab`・`Space`・`BSpace`・`Up`・`Down`・`Left`・`Right`・`Home`・`End`・`Delete`・`PageUp`・`PageDown`と、`C-a`〜`C-z`（Ctrl + 英字）。`Up`〜`PageDown`には`C-`・`M-`（Alt）・`S-`（Shift）を前に付けられ、`C-End`や`C-S-Right`のように重ねてもよい。それ以外は文字列としてそのまま送る。

1回のコマンドで並べたキーは、その順に届く。一方で、**コマンドを分けて送ったキーは、順番どおりに届くとは限らない**。順番が大事なときは1回にまとめるか、前のコマンドが終わってから次を送る。

ただし、codexのように、文字列と`Enter`が一度に届くと「改行を含む貼り付け」として扱い、送信しないアプリもある。その場合は、文字列を送り終えてから`Enter`だけを別に送る。

## 画面の内容を取る（`tab capture`）

`tab capture`で、タブの画面に今出ている内容をテキストで取り出せる。色は含まない。取れるのは見えている範囲だけで、スクロールバックは含まない。

## タブ変数（`tab var`）

タブごとに、名前と値の組を持たせられる。シェル統合はブランチ名を、エージェント統合はAIエージェントの状態をタブ変数に書き込み、サイドバーやステータスバーはそれを読んで表示している。

```sh
niwa tab var set role editor   # このタブに role=editor を付ける
niwa tab var get role          # このタブの role を出す
niwa tab var list              # このタブの変数を一覧する
niwa tab var find role editor  # 同じBoardで role=editor のタブのidを出す
```

- niwatermの中のシェルから実行すると、そのタブ自身の変数を読み書きする。ほかのタブの変数は`--tab <tabId>`で指す
- niwatermの外から実行するときは、`--tab`が必要
- 値はniwatermを起動し直しても残る。タブを閉じると消える

`tab var find`が探すのは、同じBoardの中だけ。同じ[レイアウトプリセット](/niwaterm/layouts/#別のタブにコマンドを送る)をいくつものBoardで開いていても、自分のBoardのタブだけが見つかる。

## ポップアップ（`popup`）

`popup open`で、タイルの上に重なるポップアップを開ける。コマンドを渡すと、そのコマンドが終わったときにポップアップも閉じる。

```sh
niwa popup open lazygit
```

ポップアップは、ワークスペースごとに1つだけ開ける。prefix + `` ` ``で隠したり出したりでき、隠しているあいだも中のプログラムは動き続ける。`popup promote`を使うと、ポップアップの中身をそのままふつうのタブにできる。

### 選んだ結果を受け取る

`--capture-stdout`を付けると、ポップアップの中のコマンドが出力したものを、呼び出したシェルで受け取れる。fzfの選択画面をポップアップに出して、選んだ結果だけを使う、といった使い方ができる。

```sh
selected=$(niwa popup open --capture-stdout "fzf --multi --preview 'bat --color=always {}'")
```

この使い方をまとめた`fzf-niwa`コマンドも、`niwa`コマンドと一緒に入る。`fzf-tmux`と同じ引数で使えるので、fzfのコマンド名を差し替えられるツールなら、`fzf-tmux`を`fzf-niwa`に変えるだけでfzfがポップアップに出る（[使い方](https://github.com/eetann/niwaterm/blob/main/packages/cli/README.md#fzf-niwa)）。

### `-`で始まる引数を渡すとき

`--capture-stdout`を付けずに、`--multi`のような`-`で始まる引数を含むコマンドを渡すと、`niwa`自身のオプションとして扱われてしまう。コマンド全体を引用符で囲んで、1つの文字列として渡す。

```sh
niwa popup open "fzf --multi --preview 'bat {}'"
```

## 設定が反映されないとき（`config show`）

`niwa config show`で、今使われている設定値を表示する。書いた設定が反映されないときは、まずここを見る。

```
config: /Users/you/.config/niwaterm/niwaterm.config.ts

[読み込みエラー]
ResolveMessage: Cannot find module './custom-views/notes-handlers.ts'
直前に読み込めた設定のまま動いています（下の一覧はその内容）

[無視した設定]
- appearance.fontSize: 値が不正なため既定値(13)を使います: "13px"
```

- **`[読み込みエラー]`** — 設定ファイルを読み込めなかった。直前に読み込めた設定のまま動いている
- **`[無視した設定]`** — 値が正しくなかったので、デフォルトに戻した項目

そのあとに、項目ごとの今の値が続く。関数で書いた設定（キーバインドの割り当てなど）は、値として出せないので表示しない。キーバインドの割り当ては`niwa keybind list`で確かめる。

同じ内容は、prefix + `i`でniwatermの中にも表示できる。

## アプリが動いているか確かめる（`ping`）

```sh
niwa ping
```

niwatermが動いていれば`pong (pid <プロセスID>)`と出る。CLIからniwatermに繋がらないときの確認に使う。
