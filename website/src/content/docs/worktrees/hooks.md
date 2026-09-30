---
title: ワークツリーのフックと承認
description: ワークツリーを作ったとき・Boardを開いたとき・削除するときに実行する処理と、レイアウトプリセットの適用、リポジトリの設定の承認
---

設定ファイルの`worktree`に関数を書くと、ワークツリーを作ったとき・Boardを開いたとき・削除するときに、決まった処理を実行できる。

```ts
worktree: {
  // ワークツリーを作った直後に、パッケージをインストールする
  onCreate: async () => {
    await Bun.$`bun install`;
  },
  // Boardを開いたら、作業フェーズを「実装」にする
  onOpen: async (ctx) => {
    if (ctx.created) await Bun.$`niwaterm board phase set implement --board ${ctx.boardId}`;
  },
  // ワークツリーを消す前に、コンテナを止める
  onBeforeRemove: async () => {
    await Bun.$`docker compose down`;
  },
},
```

| 項目             | 実行されるとき                        |
| ---------------- | ------------------------------------- |
| `onCreate`       | ワークツリーを作った直後              |
| `onOpen`         | ワークツリーのBoardを新しく開いたあと |
| `onBeforeRemove` | ワークツリーを削除する直前            |
| `onRemove`       | ワークツリーを削除した直後            |

どの関数も、実行中はワークツリーのディレクトリがカレントディレクトリになる（`onRemove`だけはメインのワークツリー）。`Bun.$`で実行したコマンドも、そのディレクトリで動く。

ユーザーの設定ファイルとリポジトリの`.niwaterm/config.ts`の両方に書いた場合は、ユーザー側、リポジトリ側の順に両方実行される。

## 作成後フック

`onCreate`は、`worktree new`でワークツリーを新しく作った直後、Boardを開く前に実行される。パッケージのインストールや`.env`のコピーなど、作業を始める前の準備に使う。作ってあるワークツリーを開いただけのときは実行されない。

```ts
worktree: {
  onCreate: async (ctx) => {
    await Bun.$`bun install`;
    await Bun.$`cp ${ctx.repoRoot}/.env .env`;
  },
},
```

`ctx`には`repoRoot`（メインのワークツリーのパス）・`worktreePath`（作ったワークツリーのパス）・`branch`（ブランチ名）が入る。

コマンドの出力は`worktree new`を実行したターミナルに出て、終わるまでプロンプトは戻らない。失敗するとワークツリーは作られたまま、Boardは開かずに止まる。直してから`worktree open`で開ける。

## Boardを開いた後のフック

`onOpen`は、ワークツリーのBoardを新しく開いたあとに実行される。Boardの作業フェーズやタブ変数を設定したいときに使う（`onCreate`の時点ではBoardがまだない）。

```ts
worktree: {
  onOpen: async (ctx) => {
    if (ctx.created) {
      await Bun.$`niwaterm board phase set implement --board ${ctx.boardId}`;
    }
    await Bun.$`niwaterm tab var set --tab ${ctx.tabIds[0]} role main`;
  },
},
```

| `ctx`の項目    | 内容                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| `repoRoot`     | メインのワークツリーのパス                                               |
| `worktreePath` | 開いたワークツリーのパス                                                 |
| `branch`       | ブランチ名。ブランチに乗っていないワークツリーでは`null`                 |
| `created`      | 今回の`worktree new`でワークツリーを作ったか。`worktree open`では`false` |
| `workspaceId`  | Boardがあるワークスペースのid                                            |
| `boardId`      | 開いたBoardのid                                                          |
| `tabIds`       | Boardのタブのid                                                          |

`niwaterm`コマンドで操作するときは、`--board ${ctx.boardId}`のようにidを必ず渡す。省略すると、開いたBoardではなく、`worktree new`を実行したタブが対象になる。

`worktree new`と`worktree open`のどちらでも実行されるので、作ったときだけの処理は`ctx.created`で分ける。すでに開いていたBoardへ切り替えただけのときと、`--open none`・`--open current-tab`のときは実行されない。

失敗してもBoardは閉じない。

## 削除前後のフック

`onBeforeRemove`は`worktree remove`でワークツリーを削除する直前に、`onRemove`は削除した直後に実行される。コンテナを止める、ワークツリー用に作ったデータベースを消す、といった後片付けに使う。

```ts
worktree: {
  // ワークツリーの中身がまだあるうちに片付ける
  onBeforeRemove: async () => {
    await Bun.$`docker compose down`;
  },
  // ワークツリーの外に作ったものを片付ける
  onRemove: async (ctx) => {
    if (ctx.branch !== null) await Bun.$`dropdb --if-exists app_${ctx.branch}`;
  },
},
```

`ctx`には`repoRoot`・`worktreePath`・`branch`と、`--force`付きで実行したかを表す`force`が入る。

`worktree remove`が未コミットの変更などで止まったときは、どちらも実行されない。

`onBeforeRemove`が失敗すると、そのワークツリーは削除せずに残す。片付けが終わっていないまま消すのを防ぐため。`--force`を付けたときは、失敗しても削除を続ける。

## レイアウトプリセットの適用

```sh
niwaterm worktree new feat/x --layout dev
```

ワークツリーのBoardを開くときに、[レイアウトプリセット](/niwaterm/layouts/)でタイルとタブを組み立てられる。毎回`--layout`を付ける代わりに、設定の`worktree.layout`にも書ける。

- 当てるのはBoardを新しく作ったときだけ。すでに開いていたBoardは、作業中のタブを壊さないようにそのままにする
- タブはワークツリーのディレクトリで開く。プリセットの`cwd`に相対パスを書いた場合も、ワークツリーからの相対パスになる
- プリセットは、メインのワークツリーの`.niwaterm/`に置いたものも使える
- プリセットはそのBoardの[起動時レイアウト](/niwaterm/layouts/#起動時レイアウト)にもなる。niwatermを次に起動したときも、同じプリセットでBoardを組み立て直す

## プロジェクトローカル設定の承認

リポジトリの`.niwaterm/config.ts`に書いたフックやレイアウトプリセットは、そのリポジトリを信頼すると答えるまで読み込まない。cloneしてきたリポジトリの設定に書かれたコマンドが、知らないうちに自分のマシンで実行されるのを防ぐため。

`.niwaterm/config.ts`があるリポジトリで`worktree new`や`worktree remove`を初めて実行すると、次のように確認される。

```
$ niwaterm worktree new feat/x
このリポジトリはniwatermのプロジェクトローカル設定を持っています:
  /path/to/repo/.niwaterm/config.ts
ワークツリーの操作でこのファイルが評価され、worktree.onCreate・onOpen・onBeforeRemove・onRemoveのフックやlayoutsのプリセットに書かれたコマンドが実行されます。
レイアウトプリセットを適用したBoardは起動時レイアウトとしても紐づくため、以後niwatermを起動するたびにも実行されます。
信頼できるリポジトリでのみ許可してください。
このリポジトリを信頼しますか？ (y/N)
```

- `y`と答えると、次からは確認なしで読み込む。`.niwaterm/`の中身が変わったときは、もう一度確認される
- `--trust`を付けると、確認なしで信頼する。スクリプトから実行するとき用
- 信頼しないあいだは、ワークツリーの置き場所などもリポジトリの設定を使わず、ユーザーの設定とgit configだけで決まる
