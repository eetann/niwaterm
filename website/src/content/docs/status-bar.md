---
title: ステータスバー
description: ウィンドウの下端に出すステータスバーの中身を設定ファイルで決める方法と、CLIからの更新・表示の切り替え
---

ウィンドウの下端には、横長のステータスバーが1本出る。デフォルトでは、左にキー入力のモード（`NORMAL`・`PREFIX`・`COPY`）、右に今いるディレクトリが出る。何を出すかは、設定ファイルの`statusBar`で決める。

```ts
statusBar: {
  left: ["builtin:mode", "builtin:board"],
  right: [
    { source: "tab-var:branch", prefix: " " },
    {
      source: "builtin:cwd",
      tooltip: "lazygitを開く",
      run: (ctx, niwa) => niwa.popup.open({ command: "lazygit", cwd: ctx.cwd }),
    },
    { render: () => new Date().toLocaleTimeString(), interval: 1000 },
  ],
},
```

この例では、左にモードとBoard名、右にブランチ名・ディレクトリ・時計を並べる。ディレクトリをクリックすると、lazygitがポップアップで開く。

バーは`left`・`center`・`right`の3か所に分かれていて、それぞれに出すものを配列で並べる。書かなかった場所はデフォルトのまま、`[]`を書くとその場所には何も出ない。バーごと消すときは`statusBar: false`にする。

バーに出る情報は、フォーカス中のタブのもの。タブやBoardを切り替えると、表示も切り替わる。

## 決まった情報を出す

文字列で書くと、niwatermが用意している情報を出せる。

| 書き方                | 出るもの                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `"builtin:mode"`      | キー入力のモード。`NORMAL`・`PREFIX`（prefixキーを押したあと）・`COPY`（コピーモード中）        |
| `"builtin:cwd"`       | 今いるディレクトリ（[シェル統合](/niwaterm/shell-integration/)が必要）。ホームは`~`と表示される |
| `"builtin:workspace"` | ワークスペースの名前                                                                            |
| `"builtin:board"`     | Boardの名前                                                                                     |
| `"tab-var:<name>"`    | [タブ変数](/niwaterm/cli/commands/#タブ変数tab-var)の値。ブランチ名なら`"tab-var:branch"`       |

値がないものは詰めて表示される。

`{ source: "builtin:cwd", ... }`のようにオブジェクトで書くと、前に付ける文字（`prefix`）や文字の色（`color`）、マウスを載せたときの説明（`tooltip`）、クリックしたときの処理（`run`）を足せる。

## 自分で作った表示を出す

`render`に関数を書くと、その関数が返した文字列を出せる。

```ts
statusBar: {
  right: [
    {
      id: "todo",
      render: async (ctx, niwa) => {
        const { stdout } = await niwa.shell.run("grep -c TODO ~/notes.md");
        return `TODO ${stdout.trim()}`;
      },
    },
  ],
},
```

`render`が呼ばれるのは、フォーカス中のタブ・Board・ワークスペースやタブ変数が変わったとき。時計のように時間で変わる表示は、`interval`にミリ秒を書くとその間隔で呼び直す（250ミリ秒より短くはできない）。

関数の1つ目の引数（`ctx`）で、フォーカス中のタブの情報を受け取れる。2つ目の引数は[niwa API](/niwaterm/keybindings/api/)で、コマンドを実行したりポップアップを開いたりできる。

| `ctx`の項目                     | 内容                     |
| ------------------------------- | ------------------------ |
| `workspaceId` / `workspaceName` | ワークスペースのidと名前 |
| `boardId` / `boardName`         | Boardのidと名前          |
| `tabId`                         | タブのid                 |
| `tabName`                       | タブの名前               |
| `cwd`                           | タブが今いるディレクトリ |
| `vars`                          | タブ変数                 |
| `windowId`                      | ウィンドウのid           |

文字列の代わりに`{ text, tooltip, color }`を返すと、説明や色も付けられる。`text`の代わりに`html`を返すとHTMLで表示でき、そのためのCSSは`statusBar.css`に書く。コマンドの出力などを`html`に入れるときは、自分でエスケープする。

### 外の変化に合わせて更新する

`render`がファイルやgitの状態を読んでいる場合、それらが変わってもniwatermには分からないので、表示は更新されない。変えた側から`niwaterm status-bar refresh`を実行すると、その場で表示し直す。

```sh
# ノートを編集したあとに、idが"todo"の表示だけを更新する
niwaterm status-bar refresh --item todo
```

`--item`には、`render`などと一緒に書いた`id`を渡す。

## バーを隠す

`niwaterm status-bar toggle`、またはコマンドパレットの「Toggle Status Bar」で、バーを隠したり出したりできる。隠した状態は、すべてのウィンドウで共通で、次に起動したときも続く。キーで切り替えたいときは、`toggle-status-bar`アクションを割り当てる（[キーバインド](/niwaterm/keybindings/#キーの割り当てを変える)）。

ステータスバーをまったく使わないなら、設定ファイルで`statusBar: false`にする。この場合はバーが作られないので、上の方法で出すこともできない。

```ts
statusBar: false,
```

## 設定項目の一覧

`left`・`center`・`right`の各要素にオブジェクトで書ける項目。

| 項目       | 内容                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | `niwaterm status-bar refresh --item`で指す名前。英数字・`_`・`-`で書く。省略すると`left-0`のような「場所-番号」になり、並べ替えると変わる |
| `source`   | [決まった情報](#決まった情報を出す)の書き方                                                                                               |
| `render`   | 表示を返す関数。`source`と両方書いたときは`render`が使われる                                                                              |
| `interval` | `render`を呼び直す間隔（ミリ秒）。250以上                                                                                                 |
| `prefix`   | 値の前に付ける文字。値がないときは出ない                                                                                                  |
| `color`    | 文字の色                                                                                                                                  |
| `tooltip`  | マウスを載せたときに出る説明                                                                                                              |
| `run`      | クリックしたときの処理。`(ctx, niwa) => { ... }`                                                                                          |

`builtin:mode`には`prefix`と`color`を付けられない。モードの色は[`appearance.ui`](/niwaterm/appearance/#枠やバッジの色)で変える。

## CLI

```sh
niwaterm status-bar refresh [--item <id>]
niwaterm status-bar toggle [--visible on|off]
```

- `status-bar refresh` — 表示を作り直す。`--item`でその`id`の表示だけにする。`id`を付けていない表示のidは`niwaterm config show`の`statusBar`で確かめられる
- `status-bar toggle` — バーを隠す・出す。`--visible on` / `off`で向きを決められ、省略すると今と逆になる

どちらもすべてのウィンドウが対象になる。`statusBar: false`にしているときはエラーになる。
