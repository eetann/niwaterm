---
title: カスタムビュー
description: ユーザー定義のHTML UI（customViews）をサイドバーやタブに出し、HTMLからniwatermを操作する方法
---

`customViews`は、ユーザーが用意したHTMLをniwaterm内（サイドバー・タブ）に表示するための設定。配列に並べた順でサイドバーのビュー切替に並ぶ。**未指定・空配列なら機能自体がオフ**になり、サイドバーの見た目・挙動は変化しない。

| フィールド | 型                                           | 意味                                                                                                                                                                                             |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`       | `string`                                     | キーバインド（`show-sidebar-view:<id>`）・CLI（`niwaterm sidebar switch --view <id>`）から指すためのid。未指定時は`name`から作られる（小文字化し、英数字以外は`-`へ。`Worktrees` → `worktrees`） |
| `name`     | `string`                                     | サイドバーの切替タブに表示する名前。未指定時は`"Custom View 1"`のような並び順の連番                                                                                                              |
| `path`     | `string`                                     | ローカルHTMLファイルへのパス。`~/.config/niwaterm/`（設定ファイルのあるディレクトリ）からの相対 or 絶対パス。`file://`として読み込む                                                             |
| `url`      | `string`                                     | 任意URL。`path`未指定時のみ使われる（`path`優先）                                                                                                                                                |
| `handlers` | `Record<string, (payload, niwa) => unknown>` | HTML側から`niwaterm.call`で呼べる関数。後述                                                                                                                                                      |

`path`と`url`のどちらも指定しなかった要素は、警告付きで飛ばされる（他の要素は有効なまま）。`path`が実在しないファイルを指している場合は、ビューは残したまま警告だけが出る（サイドバーには空白のビューが出る）。飛ばさないのは、ファイルの有無でid採番が変わると、HTMLを置いた途端にキーバインド・CLIから指す`id`がずれてしまうため。

```ts
customViews: [
  { name: "Notes", path: "./notes.html" },
  { id: "wt", name: "Worktrees", path: "./worktrees.html" },
],
```

idは全ビューで一意になるよう解決される。重複した場合・`name`から英数字を拾えない場合（日本語名など）・ワークスペース一覧の予約id`workspaces`と衝突した場合は、末尾に連番が付く（`notes-2`・`custom-view-1`）。解決後のidは`niwaterm config show`で確認できる。

設定すると、サイドバーの上部にビュー切替のタブが表示され、クリックでワークスペース一覧と各パネルを切り替えられる。ビューが増えてタブが収まらなくなったら、タブ列は横スクロールする。切り替え方は他にもある。

- キーバインド: 順送りは`next-sidebar-view`（既定は prefix + `shift+b`）、id指定は`show-sidebar-view:<id>`（既定キーは無い）
  ```ts
  keybindings: (niwa) => {
    niwa.keybind("1", "show-sidebar-view:workspaces");
    niwa.keybind("2", "show-sidebar-view:wt");
  },
  ```
- コマンドパレット: 「Next Sidebar View」と、ビューごとの「Show Sidebar View: <名前>」
- CLI: `niwaterm sidebar switch --view <id>`

同じHTMLはタブとしても開ける。

- キーバインド: `new-custom-view-tab`アクションを自分で割り当てる（既定キーは無い。開くのは常に先頭のビュー）
  ```ts
  keybindings: (niwa) => {
    niwa.keybind("shift+u", "new-custom-view-tab");
  },
  ```
- CLI: `niwaterm tab new --tile <tileId> --custom-view [--view <id>]`（`--url`と同時指定は不可）

内部的には既存のブラウザタブ機構（`<electrobun-webview>`）をそのまま使っている。サイドバーのパネルは初めてそのビューを表示したときに読み込まれるため、登録しただけで開いていないビューのHTMLは起動時に読まれない。

**ビューごとに別のHTMLを指すこと**。同じURLを2つのビューへ登録すると、後から開いた方のパネルが空のまま何も描画されない（`docs/known-issues/electrobun-duplicate-url-webview-stays-blank.md`）。同じUIを使い回したい場合は、本体を`<script src>`等で共有した薄いHTMLをビューの数だけ用意する。

## HTMLからniwatermを操作する（handlers）

HTMLはniwaterm本体とは別プロセス（webview）で動くため、そこから直接niwatermやOSを操作することはできない。
代わりに、`handlers`へ書いた関数をHTML側から名前で呼ぶ。

```ts
customViews: [
  {
    name: "Worktrees",
    path: "./worktrees.html",
    handlers: {
      list: async (_payload, niwa) => {
        const result = await niwa.shell.run("niwaterm worktree list");
        return result.stdout;
      },
      open: async (payload: { path: string }, niwa) => {
        await niwa.shell.run(`niwaterm worktree open "${payload.path}"`);
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

サイドバーのパネルとタブのどちらで開いても同じように使える。
関数の第1引数はHTML側が渡した`payload`、第2引数は`niwa`（キーバインドの関数ハンドラ・`mouse.selectionMenu`と同じAPI）。
設定ファイルと同じ実行環境なので、`Bun.spawn`・`node:fs`もそのまま書ける。

- `payload`と戻り値はJSONへ変換できる形に限る（関数・循環参照は渡せない）。戻り値を省略すると`null`が返る
- ハンドラが例外を投げると、HTML側の`niwaterm.call`がその`message`でrejectする
- 時間のかかる処理でも打ち切られない（gitの操作・依存のインストールをそのまま書ける）
- 関数以外を書いた項目は警告付きで無視される。呼べる名前は`niwaterm config show`で確認できる
- ハンドラ名はビューごとに独立している。別のビューに同じ名前があっても互いに影響しない
- `niwa.shell.run`の出力をパースする場合、シェル統合を入れているとプロンプトフックのOSC（cwd通知）が標準出力へ混ざる。`contrib/custom-views/worktrees/handlers.ts`の`stripOsc`が取り除き方の例

`window.niwaterm`はページの読み込みが終わってから注入されるため、HTML側のスクリプトがすぐ呼ぶと間に合わないことがある。`niwaterm:ready`イベントで待つ。

```js
function whenReady() {
  if (window.niwaterm) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener("niwaterm:ready", resolve, { once: true });
  });
}
```

呼べる名前は`window.niwaterm.handlers`にも入っているので、HTML側で機能の有無を見分けられる。
設定のホットリロードで`handlers`だけを変えた場合、HTMLは読み込み直さずこの配列だけが差し替わる。

`window.niwaterm.theme`には`appearance`の背景色・文字色・背景画像（`background`・`foreground`・`backgroundImage`）が入っている。
これをCSS変数へ流し込むと、ターミナルと同じ地の上にUIを載せられる。配色が変わったときは`niwaterm:theme`イベントが飛ぶので、そこで当て直す。

HTMLは必ず自分で地を塗ること。**webviewの背後は透けない**（`docs/known-issues/electrobun-webview-background-cannot-be-transparent.md`）ので、
地を指定しないとそこだけ白く浮く。ホバー・枠線のような中間色は、地と混ぜず文字色からの透明度だけで作ると背景のグラデーションを潰さない。

```js
function applyTheme() {
  const theme = window.niwaterm && window.niwaterm.theme;
  if (!theme) return;
  const root = document.documentElement.style;
  root.setProperty("--bg", theme.background);
  root.setProperty("--bg-image", theme.backgroundImage);
  root.setProperty("--fg", theme.foreground);
}
window.addEventListener("niwaterm:theme", applyTheme);
```

`url`でリモートのページを指している場合も同じように呼べる。そのページから`handlers`に書いた操作が実行できるということなので、自分で用意したページ以外を指すときは何を渡しているか意識する。

そのまま使える例が`contrib/custom-views/`にある（gitワークツリーの一覧・絞り込み・作成）。

## サイドバーのビューを切り替える（`sidebar switch`）

```sh
niwaterm sidebar switch --view <viewId>
```

サイドバーに出すビューを切り替える。`<viewId>`はワークスペース一覧の`workspaces`か、`niwaterm.config.ts`の`customViews`のid（どちらも`niwaterm config show`で確認できる）。サイドバーを閉じている場合は開いた上で切り替える。キーバインド（順送りの`next-sidebar-view`・id指定の`show-sidebar-view:<id>`）・コマンドパレットからの操作と同じもので、設定の詳細は[カスタムビュー](/niwaterm/custom-views/)を参照。存在しないidを指定した場合はエラーメッセージと共に終了コード1を返す。
