# Worktrees カスタムビュー

gitワークツリーの一覧をサイドバーへ出し、絞り込んで開く・新しいブランチのワークツリーを作る。

- 一覧はブランチ名・パスで絞り込める（`main`等のフラグも表示）
- 行をクリック、または絞り込み欄で`Enter`を押すと`niwaterm worktree open`で開く（開いたBoardへ遷移する）
- 下の入力欄にブランチ名を入れて`Enter`で`niwaterm worktree new`（作るだけで遷移はしない）
- `⟳`ボタンで一覧を取り直す

一覧の対象リポジトリは**一覧を取った時点で、フォーカス中タイルのアクティブタブが
いたディレクトリ**で決まる。別のリポジトリのタブへ移った後は`⟳`で取り直す。
タブのcwdの報告にはシェル統合が要るので、先に入れておく
（[docs/guide/cli.md](../../../docs/guide/cli.md)の「シェル統合」節）。

## 導入

```sh
mkdir -p ~/.config/niwaterm/custom-views
cp contrib/custom-views/worktrees/worktrees.html ~/.config/niwaterm/custom-views/
cp contrib/custom-views/worktrees/handlers.ts ~/.config/niwaterm/custom-views/worktrees-handlers.ts
```

`~/.config/niwaterm/niwaterm.config.ts`へ追記する。

```ts
import { defineConfig } from "@niwaterm/config";
import { worktreeHandlers } from "./custom-views/worktrees-handlers.ts";

export default defineConfig({
  customViews: [
    {
      name: "Worktrees",
      path: "./custom-views/worktrees.html",
      handlers: worktreeHandlers,
    },
  ],
});
```

保存するとホットリロードで反映される。サイドバー上部の「Worktrees」タブへ切り替えると一覧が出る。
タブとして大きく開きたい場合は`new-custom-view-tab`アクションへキーを割り当てるか、
`niwaterm tab new --custom-view --view worktrees`を使う。

## 変えたくなりそうなところ

すべて`handlers.ts`の中にある。

| 場所 | 既定 | 変える理由 |
|---|---|---|
| `const CLI` | `"niwaterm"` | wipビルドで試すなら`"niwaterm-dev"` |
| `create`の`--open board` | 作るが遷移しない | 作ってすぐ移りたいなら`--open board-switch` |
| `currentCwd` | フォーカス中タイルのcwd | 常に同じリポジトリを見たいなら固定パスを返す |

ワークツリーの作成先ディレクトリ・作成後に走らせるコマンドは、このビューではなく
niwaterm側の`worktree`設定（`worktree.dir`・`worktree.onCreate`）で決まる。
[docs/guide/config.md](../../../docs/guide/config.md)の「ワークツリー」節を参照。

## 削除

`customViews`からこの要素を消せばこのビューだけ消える。`customViews`ごと消すと機能ごとオフになり、サイドバーのビュー切替タブも出なくなる。
