---
title: プロジェクトローカルのレイアウト
description: リポジトリの.niwaterm/config.tsにレイアウトプリセットを置く方法と、解決の仕組み・信頼（trust）の扱い
---

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
        second: {
          kind: "tile",
          tabs: [{ name: "test", cwd: "./packages/cli", command: "bun test --watch" }],
        },
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
- `worktree new`／`worktree open`の`--layout`もプリセットを起動時レイアウトへ紐づけるが、確認はワークツリー側の承認（[「プロジェクトローカル設定の承認」節](/niwaterm/worktrees/hooks/#プロジェクトローカル設定の承認)）が兼ねるため、ここの確認は重ねて出ない。あちらは内容ハッシュ付きの記録を持つので、`.niwaterm/`の中身が変われば改めて確認が出る
