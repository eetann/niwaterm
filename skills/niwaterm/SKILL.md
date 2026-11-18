---
name: niwaterm
description: |
  niwatermターミナルを`niwa` CLIで操作する。別のタブでコマンドを動かして画面を読む、タイルの分割・タブ作成、ブラウザタブの操作、ワークツリーをBoardとして開く、デスクトップ通知など。
  niwatermのタブの中で作業しているとき（環境変数NIWATERM_TAB_IDがある）や、「niwaterm」「niwa」「別のタブで動かして」「タイルを分割して」「サーバーを横で起動して」と言われたときに使う。
allowed-tools: Bash(niwa:*)
---

# niwaterm

niwatermはターミナル・マルチプレクサ・ワークスペースを1つにしたデスクトップアプリで、`niwa`コマンドで外から操作できる。

## 始める前に

`echo $NIWATERM_TAB_ID`が空でなければ、自分はniwatermのタブの中で動いている。この場合、`--tab`・`--tile`・`--board`を省略したコマンドは自分のタブ・タイル・Boardが対象になる

## 階層とid

画面は次の5つの階層でできていて、コマンドもこの名前で対象を指す。

- Window — OSのウィンドウ
- Workspace — 案件・プロジェクトのまとまり
- Board — リポジトリやワークツリーごとの画面1枚
- Tile — Boardを分割した1区画
- Tab — タイルの中で切り替えるもの（ターミナル・ブラウザ）

`niwa list`でidを確かめてから、ほかのコマンドに渡す。**パースするなら`niwa list --json`を使う**（タブの種類・cwd・URL・タブ変数まで入る）。**idは起動し直すたびに振り直される**ので、覚えておかずに毎回`list`で引く。

## よく使うコマンド

```sh
niwa list --json                         # 全体の状態（id・cwd・タブ変数）
niwa tile split                          # 自分のタイルを分割する。新しいtileとtabのidが出る
niwa tab new                             # 自分のタイルに新しいタブを作る。tabのidが出る
niwa tab send-keys --tab tab-3 'bun run dev' Enter  # 別のタブでコマンドを動かす
niwa tab capture --tab tab-3             # そのタブの画面に今出ている内容をテキストで取る
niwa tab send-keys --tab tab-3 C-c       # 止める
niwa tab focus --tab tab-3               # ユーザーに見せたいタブを前に出す
niwa notify --title '終わりました' --body 'テストが通りました'  # デスクトップ通知
```

- `tab send-keys`の`--tab`は省略できない（自分のタブへの誤送信を防ぐため）。特殊キーは`Enter`・`Escape`・`Tab`・`C-c`など。`-`で始まる文字列は`--`の後ろに置く
- **別々のコマンドで送ったキーは順番どおりに届くとは限らない**。順番が大事なら1回にまとめる。ただし文字列と`Enter`を一度に送ると貼り付け扱いで送信しないアプリ（codexなど）もあり、その場合は`Enter`だけ後から別に送る
- `tab capture`が取るのは画面に見えている範囲だけ（スクロールバックは含まない）。コマンドの終わりを待つときは、少し間を置いてから取り直す
- ユーザーが見ているタブを勝手に閉じない・`C-c`しない。自分で作ったタブ・タイルを使う

ほかにも、ブラウザタブ（`browser navigate`・`get-text`・`screenshot`）、gitワークツリーをBoardとして開く（`worktree new`・`open`）、レイアウトプリセット（`layout apply`）、タブ変数（`tab var`）などがある。全コマンドの一覧は`niwa docs show cli`。

## 分からないときは調べる

使い方はCLIからドキュメントを読んで確かめる。このスキルに書いていないことを推測で打たない。

```sh
niwa docs search send-keys       # キーワードで全ページを検索（複数語は全部を含むページだけ）
niwa docs show cli/commands      # 検索で出てきたページを読む
niwa docs list                   # ページの一覧と説明
niwa tab new --help              # オプションの一覧
```

`docs search`の結果は、ページ名・見出し・行番号付きで出る。検索で出てきたページを`docs show <ページ名>`で読む。
