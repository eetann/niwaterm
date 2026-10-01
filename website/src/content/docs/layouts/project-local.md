---
title: プロジェクトローカルのレイアウト
description: リポジトリの.niwaterm/config.tsにレイアウトプリセットを置き、そのリポジトリでだけ使う方法
---

リポジトリの中の`.niwaterm/config.ts`に[レイアウトプリセット](/niwaterm/layouts/)を書くと、そのリポジトリでだけ使えるプリセットになる。リポジトリごとにタイルの分け方を変えたいときに使う。

```ts
// .niwaterm/config.ts
import type { NiwatermProjectConfig } from "@niwaterm/config";

export default {
  layouts: {
    dev: {
      description: "エディタ + テスト",
      layout: {
        kind: "split",
        orientation: "vertical",
        ratio: 0.6,
        first: { kind: "tile", tabs: [{ name: "editor", command: "nvim" }] },
        second: {
          kind: "tile",
          tabs: [{ name: "test", cwd: "./packages/cli", command: "bun test --watch" }],
        },
      },
    },
  },
} satisfies NiwatermProjectConfig;
```

プリセットの書き方は、`niwaterm.config.ts`の`layouts`と同じ。違うのは次の3点。

- `defineConfig`は使わず、オブジェクトをそのまま`export default`する。`import type`の行は補完のためのもので、リポジトリに`@niwaterm/config`を入れていなくても動く
- タブの`cwd`は、リポジトリの一番上（`.niwaterm/`がある場所）からの相対パスで書ける。`cwd`を省略したタブも、そこで開く
- `niwaterm.config.ts`に同じ名前のプリセットがあるときは、`.niwaterm/config.ts`のほうが使われる

どちらのプリセットが使われるかは、`niwaterm layout list`の2列目で確かめられる。`[project: <パス>]`ならリポジトリの、`[global]`なら`niwaterm.config.ts`のプリセット。

## どこの`.niwaterm/`が使われるか

`niwaterm layout list`・`layout apply`は、実行したディレクトリから親ディレクトリへ順に`.niwaterm/`を探す。リポジトリの中なら、どのサブディレクトリから実行しても同じプリセットが使える。

gitのワークツリーで作業しているときに、そのワークツリーに`.niwaterm/`がなければ、元のリポジトリの`.niwaterm/`を使う。ただし、WSLのリポジトリをWindowsのniwatermで開いているときのように、niwatermが動いているマシンにgitがないと、元のリポジトリは探せない。

`niwaterm worktree new` / `worktree open`の`--layout`は、元のリポジトリの`.niwaterm/`だけを見る。

## 信頼の確認

プロジェクトローカルのプリセットを[起動時レイアウト](/niwaterm/layouts/#起動時レイアウト)にするときは、確認が出る。起動時レイアウトにすると、niwatermを起動するたびにそのリポジトリの`.niwaterm/config.ts`が読み込まれ、プリセットの`command`が実行される。cloneしてきたリポジトリなら、書かれているコマンドが勝手に動くことになるので、信頼できるリポジトリでだけ許可する。

`worktree new` / `worktree open`の`--layout`で開いたときは、ここの確認は出ない。代わりにワークツリー側の確認（[プロジェクトローカル設定の承認](/niwaterm/worktrees/hooks/#プロジェクトローカル設定の承認)）が出る。
