---
title: カスタムビュー
description: 自分で書いたHTMLをサイドバーやタブに表示し、そのボタンからniwatermを操作する
---

カスタムビューを使うと、自分で書いたHTMLをサイドバーやタブに表示できる。HTMLのボタンからniwatermを操作することもできるので、「gitワークツリーの一覧を出して、クリックしたものをBoardで開く」のようなUIを自分で作れる。

## HTMLをサイドバーに表示する

設定ファイルの`customViews`に、表示したいHTMLファイルを並べる。

```ts
customViews: [
  { name: "Notes", path: "./notes.html" },
  { id: "wt", name: "Worktrees", path: "./worktrees.html" },
],
```

設定すると、サイドバーの上にビューを切り替えるタブが出る。ビルトインのワークスペース一覧と、`customViews`に並べたビューを切り替えられる。

| 項目       | 内容                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `name`     | 切り替えのタブに出す名前                                                                        |
| `path`     | HTMLファイルのパス。相対パスは設定ファイルのあるディレクトリ（`~/.config/niwaterm/`）から数える |
| `url`      | ファイルの代わりにURLを開く。`path`と両方書いたときは`path`が使われる                           |
| `id`       | キーやCLIからビューを指すときの名前。省略すると`name`から作られる（`Worktrees`なら`worktrees`） |
| `handlers` | HTMLから呼べる関数（[下で説明](#htmlからniwatermを操作するhandlers)）                           |

ビューごとに別のHTMLファイルを指定する。同じファイルを2つのビューに指定すると、あとから開いたほうが真っ白のままになる。同じUIを使い回したいときは、中身を`<script src>`で読み込むだけのHTMLをビューの数だけ用意する。

実際に付いた`id`は`niwaterm config show`で確かめられる。`name`が日本語のときや、ほかのビューと`id`が重なったときは、`custom-view-1`や`notes-2`のような`id`になる。

### ビューを切り替える

サイドバーのタブをクリックするほかに、次の方法で切り替えられる。

- prefix + `shift+b`で、次のビューへ順に切り替える
- `show-sidebar-view:<id>`をキーに割り当てると、そのビューへ直接切り替える。ワークスペース一覧の`id`は`workspaces`
  ```ts
  keybindings: (niwa) => {
    niwa.keybind("1", "show-sidebar-view:workspaces");
    niwa.keybind("2", "show-sidebar-view:wt");
  },
  ```
- コマンドパレットの「Show Sidebar View: <名前>」
- CLIの`niwaterm sidebar switch --view <id>`

サイドバーを閉じているときは、開いてから切り替える。

## HTMLをタブで開く

同じHTMLを、タブとしてタイルの中に開くこともできる。

- `new-custom-view-tab`をキーに割り当てる。開くのは`customViews`の最初のビュー
  ```ts
  keybindings: (niwa) => {
    niwa.keybind("shift+u", "new-custom-view-tab");
  },
  ```
- CLIの`niwaterm tab new --custom-view --view <id>`で、ビューを選んで開く

## HTMLからniwatermを操作する（handlers）

HTMLの中から、niwatermの操作やコマンドの実行を直接はできない。代わりに、設定ファイルの`handlers`に関数を書いておき、HTMLからその名前で呼ぶ。

```ts
customViews: [
  {
    name: "Worktrees",
    path: "./worktrees.html",
    handlers: {
      list: async (_payload, niwa) => {
        const result = await niwa.shell.run("git worktree list");
        return result.stdout;
      },
      open: async (payload: { path: string }, niwa) => {
        niwa.board.create(payload.path);
      },
    },
  },
],
```

```js
// worktrees.html
const stdout = await niwaterm.call("list");
await niwaterm.call("open", { path: "/path/to/worktree" });
```

関数の1つ目の引数はHTMLから渡した値、2つ目の引数は`niwa`（使える操作は[niwa API](/niwaterm/keybindings/api/)）。関数が返した値が、HTML側の`niwaterm.call`の結果になる。サイドバーでもタブでも同じように呼べる。

- やりとりできるのは、JSONにできる値だけ
- 関数でエラーが起きると、HTML側の`niwaterm.call`もエラーになる
- 時間のかかる処理（gitの操作やパッケージのインストールなど）も、途中で打ち切られない
- [シェル統合](/niwaterm/shell-integration/)を入れていると、`niwa.shell.run`の出力にシェル統合の制御文字が入ることがある。出力を解析するときは取り除く（[`contrib/custom-views/worktrees/handlers.ts`](https://github.com/eetann/niwaterm/blob/main/contrib/custom-views/worktrees/handlers.ts)の`stripOsc`が例）

`handlers`を呼べるのは、カスタムビューとして表示したページだけ。ブラウザタブでふつうに開いたWebページからは呼べない。ただし、カスタムビューの`url`にほかの人のWebページを指定した場合や、カスタムビューの中でリンクをたどってほかのページへ移った場合は、そのページからも`handlers`の関数を呼べる。自分で用意したページ以外を表示するときは、`handlers`に何を書くかに気を付ける。

### HTML側で準備を待つ

`niwaterm.call`は、ページを読み込み終わってから使えるようになる。ページを開いてすぐに呼ぶときは、`niwaterm:ready`イベントを待つ。

```js
function whenReady() {
  if (window.niwaterm) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener("niwaterm:ready", resolve, { once: true });
  });
}

await whenReady();
const stdout = await niwaterm.call("list");
```

### ターミナルと同じ配色にする

`window.niwaterm.theme`に、[外観](/niwaterm/appearance/)の背景の色（`background`）・文字の色（`foreground`）・背景の画像（`backgroundImage`）が入っている。配色が変わると`niwaterm:theme`イベントが届くので、そこで当て直す。

```js
function applyTheme() {
  const theme = window.niwaterm && window.niwaterm.theme;
  if (!theme) return;
  const root = document.documentElement.style;
  root.setProperty("--bg", theme.background);
  root.setProperty("--bg-image", theme.backgroundImage);
  root.setProperty("--fg", theme.foreground);
}
window.addEventListener("niwaterm:ready", applyTheme);
window.addEventListener("niwaterm:theme", applyTheme);
```

HTMLの背景の色は、必ず自分で指定する。指定しないと、そこだけ白くなる。

## 例

gitワークツリーの一覧・絞り込み・作成ができるカスタムビューが、リポジトリの[`contrib/custom-views/`](https://github.com/eetann/niwaterm/tree/main/contrib/custom-views)にある。そのまま使うこともできるし、自分で作るときの手本にもなる。
