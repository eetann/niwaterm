---
title: レイアウトプリセット
description: タイルの分け方と各タブで動かすコマンドをプリセットとして設定ファイルに書き、コマンド1つで開く方法
---

「左でエディタ、右上で開発サーバー、右下でログ」のようなレイアウトを保存できる。レイアウトには、単にタイルの分け方だけではなく、起動時に各タブで動かすコマンドやタブ変数も指定できる。

レイアウトは、設定ファイルの`layouts`に名前を付けてプリセットとして書く。書いたプリセットは`niwa layout apply <名前>`で新しいBoardとして開く。

```ts
layouts: {
  dev: {
    description: "エディタ + サーバー + ログ",
    layout: {
      kind: "split",
      orientation: "vertical",
      ratio: 0.6,
      first: { kind: "tile", tabs: [{ name: "editor", command: "nvim", focus: true }] },
      second: {
        kind: "split",
        orientation: "horizontal",
        first: { kind: "tile", tabs: [{ name: "server", command: "npm run dev" }] },
        second: { kind: "tile", tabs: [{ name: "logs", command: "tail -f logs/app.log" }] },
      },
    },
  },
},
```

```sh
niwa layout apply dev
```

この例では、画面を左右に6:4で分け、左でnvimを開く。右はさらに上下に分けて、上で開発サーバー、下でログを流す。各タブは、`niwa layout apply`を実行したディレクトリで開く。

## プリセットの書き方

`layout`には、タイルの分け方を入れ子で書く。

- **`{ kind: "split", ... }`** — 2つに分ける。`orientation`が`"vertical"`なら左右、`"horizontal"`なら上下に分け、`first`（左か上）と`second`（右か下）にそれぞれの中身を書く。`ratio`は`first`の大きさの割合（0〜1、デフォルトは0.5）
- **`{ kind: "tile", tabs: [...] }`** — タイル1つと、その中のタブ。タブは1つ以上書く

3つ以上に分けるときは、上の例のように`split`の中に`split`を書く。

タブに書ける項目は次のとおり。どれも省略できる。

| 項目           | 内容                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `name`         | タブの名前                                                                                                  |
| `command`      | タブを開いたあとに実行するコマンド。改行を入れると1行ずつ実行する                                           |
| `cwd`          | タブを開くディレクトリ。省略すると`niwa layout apply`を実行したディレクトリ                                 |
| `shellProfile` | 使う[シェル](/niwaterm/shell/)のid。省略するとデフォルトのシェル                                            |
| `vars`         | [タブ変数](/niwaterm/cli/commands/#タブ変数tab-var)。`{ role: "editor" }`のように書く                       |
| `focus`        | `true`にしたタブに、開いたあとフォーカスが移る。プリセット全体で1つだけ                                     |
| `delay`        | `command`を実行する前に待つ時間（ミリ秒）。シェルの準備ができるのを待ってから実行するので、ふだんは要らない |

`tile`には`activeTab`（最初に表示するタブの番号。0から数える）も書ける。省略すると最後のタブが表示される。

`command`は、コマンドを貼り付けたのと同じ扱いで入力される。そのため、zshの略語展開のような、1文字ずつ打ったときに働く機能は使えない。

`description`は`niwa layout list`の一覧に出る説明で、省略できる。

### 別のタブにコマンドを送る

同じプリセットの中の別のタブへ、コマンドから何かを送りたいときは、送り先のタブに`vars`で目印を付けておき、`niwa tab var find`で探す。

```ts
layout: {
  kind: "split",
  orientation: "vertical",
  first: {
    kind: "tile",
    tabs: [{ name: "claude", command: "claude", vars: { role: "claude" } }],
  },
  second: {
    kind: "tile",
    tabs: [
      {
        name: "editprompt",
        command:
          'target=$(niwa tab var find role claude | head -n1); ' +
          '[ -n "$target" ] && editprompt open --editor nvim --target-pane "$target"',
        focus: true,
      },
    ],
  },
},
```

`tab var find`は同じBoardの中だけを探すので、同じプリセットを何度開いても、別のBoardのタブと取り違えない。`vars`は`command`より先に付くので、先に書いたタブの目印は、あとに書いたタブの`command`から見つけられる。

## 開く

```sh
# 使えるプリセットを一覧する
niwa layout list

# 新しいBoardとして開く
niwa layout apply dev

# 今のBoardを閉じて、プリセットで開き直す
niwa layout apply dev --replace
```

`--replace`は、今のBoardのタブをすべて閉じてからプリセットを開く。動いているプログラムも止まるので、実行前に確認が出る。確認なしで実行するときは`--replace-force`を使う。

プリセットに誤り（存在しないシェルのid、`focus: true`が2つある、など）があるときは、Boardには何もせずにエラーになる。

## リポジトリごとにプリセットを置く

プリセットは、ユーザーの設定ファイル（`niwaterm.config.ts`）のほかに、リポジトリの中の`.niwaterm/config.ts`にも書ける。こちらに書いたプリセットは、そのリポジトリの中で`niwa layout apply`を実行したときだけ使える。リポジトリごとにタイルの分け方を変えたいときに使う。

```ts
// .niwaterm/config.ts
import type { NiwatermProjectConfig } from "@niwaterm/config";

export default {
  layouts: {
    dev: {
      layout: { kind: "tile", tabs: [{ name: "test", command: "bun test --watch" }] },
    },
  },
} satisfies NiwatermProjectConfig;
```

書き方の違いや、同じ名前のプリセットがあるときにどちらが使われるかは、[プロジェクトローカルのレイアウト](/niwaterm/layouts/project-local/)を参照。

## ビルトインのプリセット

設定ファイルに何も書かなくても、`empty`というプリセットが使える。

```sh
# 今のBoardを片付けて、タイル1つ・タブ1つにする
niwa layout apply empty --replace
```

残るタブも起動し直すので、そのBoardで動いていたプログラムはすべて止まる。引き継ぐのは、残るタブが今いるディレクトリだけ。`--replace`を付けなければ、空のBoardを1つ作るだけになる。

同じ名前のプリセットを自分で書くと、そちらが使われる。

## 起動時レイアウト

デフォルトでは、niwatermは終了したときのタイルの分け方やタブの名前を覚えていて、次に起動したときに元に戻す。ただし、プリセットの`command`は実行し直さない。

Boardに起動時レイアウトを紐づけると、そのBoardは次に起動したときもプリセットから開き直すので、`command`も毎回実行される。「このBoardは毎回サーバーを立ち上げた状態で始めたい」ときに使う。起動時レイアウトを紐づけたBoardには、サイドバーでアイコンが付く。

起動したときにプリセットが設定ファイルから消えていると、そのBoardはタブ1つで開き、デスクトップ通知で知らせる。プリセットの名前を変えたときは、新しい名前で紐づけ直す。

[ワークツリー](/niwaterm/worktrees/hooks/#レイアウトプリセットの適用)を`--layout`付きで開いたBoardは、`--startup`を付けなくても起動時レイアウトになる。

### サイドバーから紐づける

サイドバーのBoardを右クリックして、「起動時レイアウト」からプリセットを選ぶ。選んだプリセットで、その場でBoardを開き直す（実行前に確認が出る）。紐づけを外すときは、同じメニューの「紐づけを解除」を選ぶ。

### CLIから紐づける

プリセットを開くときに`--startup`を付けると、開いたBoardに起動時レイアウトが紐づく。

```sh
niwa layout apply dev --startup
```

あとから変えるときは`niwa board startup`を使う。

```sh
# 次に起動したとき、プリセットから開き直す
niwa board startup layout --preset dev
# 次に起動したとき、終了したときの状態に戻す（プリセットの紐づけは残す）
niwa board startup restore
# プリセットの紐づけを外す
niwa board startup clear
```

`--board <boardId>`で対象のBoardを選べる。省略すると今のBoardが対象になる。`--preset`を省略すると、そのBoardで前に使ったプリセットを使う。

起動時にタブを開くディレクトリは、`--startup`を付けて実行したディレクトリになる。別のディレクトリにしたいときは、そのディレクトリで`niwa layout apply dev --replace --startup`を実行し直す。

## CLI

```sh
niwa layout list [--cwd <dir>]
niwa layout apply <name> [--replace | --replace-force] [--board <boardId>] [--workspace <workspaceId>] [--cwd <dir>] [--startup] [--trust]
```

- `layout list` — プリセットを`名前<TAB>定義した場所<TAB>説明`の形で一覧する。定義した場所は`[project: <パス>]`・`[global]`・`[builtin]`のどれか
- `layout apply` — プリセットを開き、作ったBoardのidを表示する
  - `--workspace` — 新しいBoardを作るワークスペース。省略すると今のワークスペース
  - `--replace` / `--replace-force` — 既存のBoardを開き直す。対象は`--board`で選び、省略すると今のBoard。タイルもタブも1つだけのBoardなら、確認は出ない
  - `--cwd` — `cwd`を書いていないタブを開くディレクトリ。省略すると実行したディレクトリ
  - `--startup` — [起動時レイアウト](#起動時レイアウト)にする
  - `--trust` — [プロジェクトローカルのプリセット](/niwaterm/layouts/project-local/#信頼の確認)で出る確認を省く

`--cwd`は、`layout list`ではプロジェクトローカルのプリセットを探し始めるディレクトリになる。
