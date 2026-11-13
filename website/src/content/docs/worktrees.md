---
title: ワークツリー
description: ブランチごとにgitワークツリーを作り、それぞれをBoardとして開く・切り替える・削除する
---

`niwa worktree`コマンドを使うと、ブランチごとにgitのワークツリー（ブランチ別の作業ディレクトリ）を作り、それぞれを[Board](/niwaterm/concepts/#board)として開ける。サイドバーでBoardを切り替えるだけで、ブランチごとの作業場所を行き来できる。

```sh
niwa worktree new feat/login     # ワークツリーを作ってBoardで開く
niwa worktree open feat/login    # 作ったワークツリーを開く
niwa worktree list               # ワークツリーの一覧
niwa worktree remove feat/login  # ワークツリーを削除してBoardを閉じる
```

作ったときにパッケージをインストールする、削除するときにコンテナを止める、といった処理も設定ファイルに書ける（[ワークツリーのフックと承認](/niwaterm/worktrees/hooks/)）。

## ワークツリーを作る

```sh
niwa worktree new feat/login
```

ブランチ`feat/login`のワークツリーを作り、Boardとして開く。Boardにはブランチ名が付く。

- **置き場所** — デフォルトではリポジトリの隣に`<リポジトリ名>@<ブランチ名>`というディレクトリで作る。ブランチ名の`/`は`-`になるので、`niwaterm`リポジトリの`feat/login`なら`../niwaterm@feat-login`。場所は[設定](#設定worktree)か`--path`で変えられる
- **ブランチ** — 手元にあるブランチ、リモートにあるブランチの順に探し、どちらにもなければ今のHEADから新しく作る
- **開き方** — デフォルトでは、Boardを作っても今のBoardのまま切り替えない。作業を止めずに次のブランチを用意しておける。すぐに切り替えたいときは`--open board-switch`を付ける

同じブランチのワークツリーがすでにあるときは、新しく作らずにそれを開く。同じコマンドを何度実行しても大丈夫。

### リモートのブランチから作る

手元にないブランチ名を渡すと、リモートのブランチから作る。誰かがpushしたブランチをレビューしたいときは、ブランチ名を渡すだけでよい。作る前に`git fetch`するので、pushされたばかりのブランチも見つかる。

```sh
niwa worktree new feat/x          # 手元 → リモート → 新規 の順に探す
niwa worktree new origin/feat/x   # リモートから作ると明示する
```

できたブランチはリモートのブランチを追跡するので、そのまま`git pull`・`git push`できる。リモートが複数あるときは`origin`を使う。別のリモートにするときは`--remote upstream`か`upstream/feat/x`のように指定する。

fetchに失敗しても、警告を出して作成を続ける。オフラインでも手元のブランチのワークツリーは作れる。

## ワークツリーを開く

```sh
niwa worktree open feat/login
```

作ってあるワークツリーをBoardとして開き、そのBoardへ切り替える。ワークツリーはブランチ名・パス・ディレクトリ名のどれでも指定できる。そのワークツリーのBoardがすでに開いていれば、新しく作らずにそのBoardへ切り替える。

## ワークツリーの一覧

```sh
niwa worktree list
```

```
/home/me/ghq/github.com/me/niwaterm            main  3aa3f4f4...  main
/home/me/ghq/github.com/me/niwaterm@feat-login feat/login  2dbbd095...  -
```

パス・ブランチ・コミット・状態をタブ区切りで出す。1行目はいつもメインのワークツリー（最初にcloneしたディレクトリ）。4列目の状態には`main`・`detached`・`locked`などが入り、何もなければ`-`になる。

`worktree list`はniwatermが起動していなくても使える。

## ワークツリーを削除する

```sh
niwa worktree remove feat/login
```

ワークツリーをディレクトリごと削除し、そのワークツリーのBoardを閉じる。スペースで区切って複数指定できる。デフォルトではブランチは残る。

コミットしていない変更などが残っているときは、何も消さずに止まる。それでも消すときは`--force`を付ける。

- ブランチも消すときは`--delete-branch`を付ける。まだマージしていないブランチは`--force`も必要
- Boardを閉じずに残すときは`--keep-board`を付ける
- このコマンドを実行したタブがあるBoardは閉じない。削除したワークツリーのタブから実行したときは、そのBoardが残るので手で閉じる

Windowsでは、削除するワークツリーを別のシェルやエディタで開いたままだと削除に失敗する。先に閉じておく。

## Boardに紐づくワークツリー

Boardには「このBoardはこのワークツリーの作業用」という紐づけを1つ付けられる。`worktree new`・`worktree open`で開いたBoardには自動で付く。それ以外のBoardには、次のどれかで付ける。

- サイドバーのBoardを右クリックして「ワークツリーを設定」を選ぶ。入力欄には今のディレクトリが入っているので、そのまま確定すればよい
- コマンドパレットから`Set Board Worktree Directory`を実行する
- CLIで`niwa board worktree set .`を実行する（`.`は今いるディレクトリ）

紐づけておくと、次のように動く。

- `worktree open`で、そのワークツリーのBoardがすでに開いていれば、新しく作らずにそこへ切り替える。Boardの中で`cd`しても変わらない
- ワークツリーのディレクトリがなくなると、サイドバーのBoardに警告のアイコンが出る
- [`board.newTabCwd: "worktree"`](/niwaterm/boards/#新しいタブを開く場所)にすると、新しいタブやタイルがワークツリーのディレクトリで開く

紐づけを外すときは、入力欄を空にして確定するか、`niwa board worktree clear`を実行する。

## 設定（`worktree`）

設定ファイルの`worktree`で、置き場所やデフォルトの開き方を変えられる。

```ts
worktree: {
  dir: ".worktrees/${branch}",
  open: "board-switch",
  layout: "dev",
},
```

| 項目             | デフォルト             | 内容                                                                                                                                         |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir`            | `../${repo}@${branch}` | ワークツリーを作る場所。`${repo}`はリポジトリ名、`${branch}`はブランチ名になる。`~/`で始まるパス・絶対パス・リポジトリからの相対パスで書ける |
| `open`           | `"board"`              | `worktree new`の開き方（下の`--open`の表）                                                                                                   |
| `layout`         | なし                   | 新しく作ったBoardに当てる[レイアウトプリセット](/niwaterm/layouts/)の名前                                                                    |
| `fetch`          | `true`                 | ワークツリーを作る前に`git fetch`するか                                                                                                      |
| `onCreate`       | なし                   | ワークツリーを作った直後に実行する処理（[フック](/niwaterm/worktrees/hooks/#作成後フック)）                                                  |
| `onOpen`         | なし                   | Boardを開いた後に実行する処理（[フック](/niwaterm/worktrees/hooks/#boardを開いた後のフック)）                                                |
| `onBeforeRemove` | なし                   | ワークツリーを削除する直前に実行する処理（[フック](/niwaterm/worktrees/hooks/#削除前後のフック)）                                            |
| `onRemove`       | なし                   | ワークツリーを削除した直後に実行する処理（[フック](/niwaterm/worktrees/hooks/#削除前後のフック)）                                            |

### リポジトリごとに設定する

リポジトリの`.niwaterm/config.ts`にも`worktree`を書ける。項目ごとに、リポジトリの設定がユーザーの設定より優先される。

```ts
// <リポジトリ>/.niwaterm/config.ts
import type { NiwatermProjectConfig } from "@niwaterm/config";

export default {
  worktree: { dir: ".worktrees/${branch}" },
} satisfies NiwatermProjectConfig;
```

リポジトリの設定は、`worktree new`などの実行時に出る確認で信頼するまで読み込まれない（[プロジェクトローカル設定の承認](/niwaterm/worktrees/hooks/#プロジェクトローカル設定の承認)）。

niwatermを入れていない環境と設定を共有したいときは、git configにも書ける。優先順位はniwatermの設定ファイルより低い。

```sh
git config niwaterm.worktree.dir '.worktrees/${branch}'
git config niwaterm.worktree.open board-switch
git config niwaterm.worktree.fetch false
```

## GUIから使う

サイドバーにワークツリーの一覧を出して、クリックで開いたり、ブランチ名を入れて作ったりできる[カスタムビュー](/niwaterm/custom-views/)のサンプルがある。[`contrib/custom-views/worktrees/`](https://github.com/eetann/niwaterm/tree/main/contrib/custom-views/worktrees)のREADMEを参照。一覧には、フォーカス中のタブがいるリポジトリのワークツリーが出る（[シェル統合](/niwaterm/shell-integration/)が必要）。

## オプション

### `worktree new`

| オプション               | 内容                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `--open <mode>`          | 開き方（下の表）。デフォルトは設定の`worktree.open`、書いていなければ`board`                           |
| `--name <name>`, `-n`    | Boardの名前。デフォルトはブランチ名                                                                    |
| `--layout <name>`        | 新しく作ったBoardに当てる[レイアウトプリセット](/niwaterm/worktrees/hooks/#レイアウトプリセットの適用) |
| `--workspace <id>`, `-w` | Boardを作るワークスペース。名前の一部でもよい。デフォルトは今のワークスペース                          |
| `--path <dir>`           | ワークツリーを作る場所                                                                                 |
| `--from <ref>`           | 新しく作るブランチの分岐元。デフォルトはHEAD                                                           |
| `--track <mode>`         | ブランチの探し方。`auto`（デフォルト。手元 → リモート → 新規）・`local`・`remote`・`new`               |
| `--remote <name>`        | 使うリモート                                                                                           |
| `--fetch` / `--no-fetch` | 作る前に`git fetch`するか                                                                              |
| `--trust`                | リポジトリの設定を確認なしで信頼する                                                                   |
| `--cwd <dir>`            | このディレクトリのリポジトリを対象にする。デフォルトは実行したディレクトリ                             |

| `--open`の値   | 開き方                                             |
| -------------- | -------------------------------------------------- |
| `board`        | Boardを作るが、切り替えない                        |
| `board-switch` | Boardを作って切り替える                            |
| `current-tab`  | 実行したタブでワークツリーのディレクトリへ`cd`する |
| `none`         | 開かない（ワークツリーを作るだけ）                 |

### `worktree open`

`--open`・`--name`・`--layout`・`--workspace`・`--trust`・`--cwd`を`worktree new`と同じように使える。`--open`のデフォルトは`board-switch`。

### `worktree remove`

| オプション        | 内容                                                               |
| ----------------- | ------------------------------------------------------------------ |
| `--force`, `-f`   | 未コミットの変更・pushしていないコミット・ロックがあっても削除する |
| `--delete-branch` | ブランチも削除する                                                 |
| `--keep-board`    | Boardを閉じずに残す                                                |
| `--trust`         | リポジトリの設定を確認なしで信頼する                               |
| `--cwd <dir>`     | このディレクトリのリポジトリを対象にする                           |

### `board worktree`

| コマンド                         | 内容                               |
| -------------------------------- | ---------------------------------- |
| `niwa board worktree set <path>` | Boardにワークツリーを紐づける      |
| `niwa board worktree clear`      | 紐づけを外す                       |
| `niwa board worktree show`       | 紐づけているワークツリーを表示する |

どれも`--board <boardId>`で対象のBoardを指定できる。省略すると、実行したタブのBoardが対象になる。
