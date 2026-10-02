---
title: サイドバーのツールバー
description: サイドバーの上にあるツールバーへ、自分で決めたボタンや表示を並べる方法
---

サイドバーの上のツールバーには、自分で決めたボタンを並べられる。「今いるディレクトリでlazygitを開く」ボタンや、niwatermを終了するボタンを置ける。デフォルトでは、右端にコマンドパレットを開くボタンだけがある。何を並べるかは、設定ファイルの`sidebar.toolbar`で決める。

```ts
sidebar: {
  toolbar: {
    left: [
      {
        icon: "git-branch",
        tooltip: "lazygitを開く",
        run: (ctx, niwa) => niwa.popup.open({ command: "lazygit", cwd: ctx.cwd }),
      },
      { icon: "git-branch", source: "tab-var:branch" },
    ],
    right: ["builtin:command-palette", { icon: "power", tooltip: "終了", action: "quit-app" }],
  },
},
```

この例では、左にlazygitのボタンとブランチ名、右にコマンドパレットと終了のボタンを並べる。

ツールバーは`left`・`right`の2か所に分かれていて、それぞれに並べるものを配列で書く。書かなかった場所はデフォルトのまま、`[]`を書くとその場所には何も出ない。ツールバーごと消すときは`toolbar: false`にする。

書き方は[ステータスバー](/niwaterm/status-bar/)とほぼ同じ。ステータスバーと同じく、`run`などで使う情報はフォーカス中のタブのもの。

## ボタンを置く

`icon`・`label`・`html`のどれかでボタンの見た目を決め、`run`か`action`で押したときの処理を書く。

- `icon` — [lucide](https://lucide.dev/icons/)のアイコン名。サイトに載っている`git-branch`のような名前で書く。見つからない名前を書くと、`?`のアイコンが出る
- `label` — ボタンに出す文字。`icon`と一緒に書くと、アイコンの右に文字が出る
- `html` — 文字の代わりに出すHTML。見た目は`sidebar.toolbar.css`に書く
- `run` — 押したときに呼ぶ関数。`(ctx, niwa) => { ... }`の形で、引数は[ステータスバーの`render`](/niwaterm/status-bar/#自分で作った表示を出す)と同じ
- `action` — 押したときに実行する[キーバインドのアクション](/niwaterm/keybindings/actions/)。`"quit-app"`ならniwatermを終了する

`run`も`action`も書かなければ、押せない表示だけになる。

### タイトルバーを隠しているとき

[`appearance.titleBar`](/niwaterm/appearance/)を`"hidden"`にすると、ツールバーがウィンドウを動かすための取っ手を兼ねる。ボタン以外のところをドラッグすれば、ウィンドウを動かせる。Windowsでは閉じるボタンも一緒に消えるので、終了するボタンを置いておくと便利。

macOSでは、ウィンドウを閉じる・最小化するボタンがツールバーの左端に重なる。重ならないように、左に並べたものは右へずれて表示される。

**`toolbar: false`にすると、ウィンドウを動かすための取っ手もなくなる。** タイトルバーを隠しているなら、ツールバーは残しておく。

## 値を表示する

`source`か`render`を書くと、ボタンの代わりにその値が出る。書き方は[ステータスバー](/niwaterm/status-bar/#決まった情報を出す)と同じで、`builtin:cwd`・`builtin:workspace`・`builtin:board`・`tab-var:<name>`と`render`関数を使える。`builtin:mode`は使えない。

```ts
sidebar: {
  toolbar: {
    left: [
      { icon: "folder", source: "builtin:cwd" },
      { icon: "clock", render: () => new Date().toLocaleTimeString(), interval: 1000 },
    ],
  },
},
```

`icon`を一緒に書くと、値の前にアイコンが出る。値がないときは、アイコンごと詰めて表示される。`run`や`action`を書けば、値を押せるようにもできる。

## 設定項目の一覧

`left`・`right`の各要素にオブジェクトで書ける項目。文字列で書くと`source`だけを書いたのと同じになる。

| 項目       | 内容                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `id`       | 名前。英数字・`_`・`-`で書く。省略すると`left-0`のような「場所-番号」になる                          |
| `source`   | `"builtin:command-palette"`（コマンドパレットのボタン）か、[値を表示する](#値を表示する)ときの書き方 |
| `render`   | 表示を返す関数。`source`と両方書いたときは`render`が使われる                                         |
| `interval` | `render`を呼び直す間隔（ミリ秒）。250以上                                                            |
| `icon`     | lucideのアイコン名                                                                                   |
| `label`    | ボタンに出す文字。`source`・`render`と一緒には使えない                                               |
| `html`     | 文字の代わりに出すHTML。`source`・`render`と一緒には使えない                                         |
| `prefix`   | 値の前に付ける文字                                                                                   |
| `color`    | 文字の色                                                                                             |
| `tooltip`  | マウスを載せたときに出る説明                                                                         |
| `run`      | 押したときの処理。`(ctx, niwa) => { ... }`                                                           |
| `action`   | 押したときに実行するキーバインドのアクション。`run`と両方書いたときは`run`が使われる                 |

`sidebar.toolbar.css`には、`html`で使うCSSを書く。`niwa config show`の`sidebar`で、並んでいるもののidと中身を確かめられる。
