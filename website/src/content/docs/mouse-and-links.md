---
title: マウスとリンク
description: 選択したら自動でコピー・コピーモードへ入る設定、選択範囲の右クリックメニュー、画面上のURLをクリックで開く設定
---

マウスで文字を選んだときの動きと、画面に出たURLをクリックで開く動きは、設定ファイルの`mouse`と`link`で変えられる。

## 選択したら自動でコピーする

`mouse.copyOnSelect: true`にすると、マウスで文字を選び終えた時点でクリップボードへコピーされる。デフォルトは`false`。

```ts
mouse: {
  copyOnSelect: true,
},
```

コピーすると、ターミナルの右上に`COPIED · 2行`のような表示が少しのあいだ出る。

vimのようにマウスを使うアプリを開いているあいだは、ドラッグがアプリ側に渡る。そのときは`shift`を押しながらドラッグすると文字を選べる。

## 選択したらコピーモードへ入る

`mouse.copyModeOnSelect: true`にすると、マウスで文字を選び終えた時点で、その範囲を選んだ状態の[コピーモード](/niwaterm/jump-and-copy/#コピーモードvi風のキーボード選択)に入る。マウスで大まかに選んでから、キーボードで範囲を整えてコピーできる。デフォルトは`false`。

```ts
mouse: {
  copyModeOnSelect: true,
},
```

`copyOnSelect`と両方を`true`にすると、選び終えた時点でクリップボードへコピーしてからコピーモードに入る。

この設定をしていなくても、選んだままprefix + `v`を押すか、右クリックメニューの「コピーモードで続ける」を選べば同じように入れる。

## 選択範囲の右クリックメニュー（selectionMenu）

文字を選んだ状態で右クリックすると、メニューが出る。メニューの先頭にはいつも「コピー」と「コピーモードで続ける」があり、その下に`mouse.selectionMenu`で決めた項目が並ぶ。選んだファイルのパスをエディタで開く、といった項目を足せる。

```ts
mouse: {
  selectionMenu: (selection, niwa) => {
    const path = selection.text.trim();
    const opener = process.platform === "win32" ? "explorer.exe" : "open";
    return [
      {
        label: `${opener}で開く`,
        run: () => niwa.shell.run(`${opener} '${path}'`, { cwd: selection.cwd }),
      },
    ];
  },
},
```

`selectionMenu`は右クリックするたびに呼ばれる関数で、メニューの項目の配列を返す。各項目は、メニューに出す名前（`label`）と、選んだときに実行する関数（`run`）を持つ。選んだ文字列の拡張子やOSで、if文を使って項目を出し分けられる。空の配列を返すと「コピー」と「コピーモードで続ける」だけになる。

1つ目の引数`selection`には、選んだ範囲の情報が入る。

| 項目    | 内容                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------- |
| `text`  | 選んだ文字列                                                                                              |
| `tabId` | 選んだ文字列があるタブのid                                                                                |
| `cwd`   | そのタブが今いるディレクトリ。[シェル統合](/niwaterm/shell-integration/)を入れていないと`undefined`になる |

2つ目の引数`niwa`では、コマンドの実行（`niwa.shell.run`）やポップアップ（`niwa.popup.open`）といったniwatermの操作ができる。使える操作は[niwa API](/niwaterm/keybindings/api/)を参照。

選んだ文字列をコマンドに渡すときは、空白や記号が入っていてもそのまま渡せるように`'...'`で囲む。相対パスを開くには`cwd`が要るので、シェル統合を入れておく。

## URLをクリックで開く

画面に出たURLは、修飾キーを押しながらクリックすると開く。修飾キーを押しているあいだは、マウスを乗せたURLに下線が出る。修飾キーのデフォルトは、macOSが`cmd`、Windowsが`ctrl`。

`gh`や`eza --hyperlink`のように、リンクとして出力するコマンドのリンクも同じように開ける。

```ts
link: {
  modifier: "alt",
  open: "browser-tab",
},
```

| 項目       | デフォルト                        | 内容                                                                                                          |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `modifier` | macOSは`"cmd"`、Windowsは`"ctrl"` | クリックするときに押す修飾キー。`"cmd"`・`"ctrl"`・`"alt"`・`"shift"`から選ぶ                                 |
| `open`     | `"external"`                      | 開く先。`"external"`はいつも使っているブラウザ、`"browser-tab"`はniwatermの[ブラウザタブ](/niwaterm/browser/) |
| `rules`    | URLとメールアドレス               | URLとみなす文字列のパターン（[下で説明](#urlとみなすパターンlinkrules)）                                      |

`open: "browser-tab"`にすると、クリックしたタブと同じタイルにブラウザタブが開く。`mailto:`のリンクは、この設定でもメールアプリで開く。

開けるのは`http`・`https`・`mailto`のリンクだけ。画面の幅で折り返されて2行にまたがったURLは、クリックしても開けない。

### URLとみなすパターン（`link.rules`）

デフォルトでは、`https://...`のようなURL、`mailto:...`、メールアドレスをリンクとして扱う。チケット番号のような自分の書き方もリンクにしたいときは、`link.rules`にパターンを足す。

```ts
import { defaultLinkRules, defineConfig } from "@niwaterm/config";

export default defineConfig({
  link: {
    rules: [
      ...defaultLinkRules,
      { regex: /\bISSUE-(\d+)\b/, format: "https://example.com/issues/$1" },
    ],
  },
});
```

この例では、画面に出た`ISSUE-123`をクリックすると`https://example.com/issues/123`が開く。

- `regex`は正規表現で、`format`は開くURLの組み立て方。`$0`がマッチした文字列全体、`$1`以降が`()`で囲んだ部分に置き換わる。`format`を省くと、マッチした文字列をそのまま開く
- `rules`を書くとデフォルトのパターンは消えるので、残したいときは上の例のように`...defaultLinkRules`を入れる
- 同じ場所に複数のパターンが当てはまるときは、先に書いたものが使われる
- `rules: []`にすると、リンクとして出力されたものだけが開けるようになる

### 開く処理を差し替える（`niwa.on("open-link", ...)`）

URLをクリックしたときの処理を、自分で書いた関数に差し替えられる。`keybindings`の関数の中で`niwa.on("open-link", ...)`を呼ぶ。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    niwa.on("open-link", (event) => {
      // GitHubのPRはポップアップにghで中身を出し、それ以外はいつもどおり開く
      if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(event.url)) {
        niwa.popup.open({ command: `gh pr view '${event.url}' | less`, width: 80, height: 80 });
        return;
      }
      niwa.link.default(event);
    });
  },
});
```

差し替えると、`link.open`の設定どおりに開く処理は動かなくなる。いつもどおりに開きたいURLでは、上の例のように`niwa.link.default(event)`を呼ぶ。`link.open`の設定に関係なくいつも使っているブラウザで開くときは、`niwa.link.openExternal(event.url)`を呼ぶ。

関数に渡る`event`の中身は次のとおり。

| 項目               | 内容                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `url`              | 開こうとしているURL（`link.rules`の`format`で組み立てたあとの値）                                         |
| `text`             | 画面に出ていた文字列                                                                                      |
| `tabId` / `tileId` | クリックしたタブとタイルのid                                                                              |
| `cwd`              | そのタブが今いるディレクトリ。[シェル統合](/niwaterm/shell-integration/)を入れていないと`undefined`になる |
