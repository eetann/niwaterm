---
title: コマンドテンプレート
description: よく打つコマンドの一部だけを差し替えて使い回す。差し替える部分を入力欄で埋めて、タブへ入力する
---

コマンドテンプレートを使うと、よく打つコマンドの一部だけを差し替えて使い回せる。テンプレートを開くと入力欄が並び、差し替える部分を埋めると、でき上がったコマンドをアクティブなタブへ入力する。ワークスペースのidのように調べて書き写すのが面倒な値も、名前の一覧から選べる。

テンプレートは設定ファイルの`commandTemplates`に書く。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  commandTemplates: [
    {
      id: "worktree",
      name: "worktreeを作る",
      description: "ブランチを切ってworktreeを作り、選んだワークスペースにBoardを開く",
      command: "niwa worktree new {{branch}} --workspace {{workspace}}",
      fields: {
        branch: { label: "ブランチ名", placeholder: "feat/..." },
        workspace: { label: "ワークスペース", options: "workspace" },
      },
    },
  ],
});
```

`command`の中の`{{branch}}`のように二重の波括弧で囲んだ部分が、差し替える部分になる。この例では、ブランチ名を打つ欄と、ワークスペースを名前で選ぶ欄が並ぶ。選んだワークスペースは、コマンドにはidで入る。

## テンプレートを開く

コマンドパレットを開くと、先頭の「テンプレート」にテンプレートが並ぶ。選ぶと入力画面が開く。

入力画面の上には、でき上がるコマンドが表示される。入力中の欄にあたる部分は色が変わる。`Tab`で次の欄へ移り、埋め終わったら次のどれかで送る。

| キー               | 動作                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `Ctrl+Enter`       | アクティブなタブへ入力する。Enterは押さないので、確かめてから実行できる |
| `Ctrl+Shift+Enter` | アクティブなタブへ入力して、そのまま実行する                            |
| `Ctrl+Shift+C`     | クリップボードへコピーして閉じる                                        |

macOSでは`Ctrl`のかわりに`Cmd`を押す。空の欄が残っているあいだは送れない。

`Enter`だけでは送らない。選択肢の欄で`Enter`を押すと、候補の一覧が開く。一覧では`Tab`・`Shift+Tab`（`↓`・`↑`でもよい）で候補を移り、`Enter`で選ぶ。

### キーバインド・ホバーボタンから開く

`niwa.commandTemplate.open(id)`で、コマンドパレットを通さずに入力画面を開ける。`id`はテンプレートに書いた`id`。

```ts
export default defineConfig({
  keybindings: (niwa) => {
    niwa.keybind("w", (niwa) => niwa.commandTemplate.open("worktree"), {
      description: "worktreeを作る",
    });
  },
  hoverButtons: [
    {
      position: "bottom-right",
      items: (tab, niwa) => [
        { label: "worktreeを作る", run: () => niwa.commandTemplate.open("worktree") },
      ],
    },
  ],
});
```

`id`を書かなかったテンプレートは、`name`から作ったidになる。`niwa config show`の`commandTemplates`で確かめられる。

## 入力欄の種類（fields）

`fields`には、`{{name}}`ごとの入力欄を書く。`fields`に書かなかった部分は、見出しがその名前の、自由に入力する欄になる。

```ts
fields: {
  // 自由に入力する欄
  branch: { label: "ブランチ名", placeholder: "feat/...", default: "feat/" },
  // 決まった選択肢から選ぶ欄
  env: { options: ["dev", "stg", { label: "本番", value: "prod" }] },
  // ワークスペースの一覧から選ぶ欄
  workspace: { options: "workspace" },
  // 開くたびに選択肢を作る欄
  base: {
    options: async (tab, niwa) => {
      const result = await niwa.shell.run("git branch --format='%(refname:short)'", { cwd: tab.cwd });
      return result.stdout.split("\n").filter((line) => line !== "");
    },
  },
},
```

選択肢は、文字列か`{ label, value, description? }`で書く。文字列は表示とコマンドに入る値が同じになる。`label`と`value`を分けると、`label`を表示して`value`をコマンドに入れる。選択肢の一覧では、文字を打って絞り込める。

`options`に関数を書くと、入力画面を開くたびに呼ばれる。1つ目の引数`tab`には開いたときのアクティブなタブの情報（`tabId`・`cwd`・`vars`）が、2つ目の引数`niwa`には[niwa API](/niwaterm/keybindings/api/)が入る。gitのブランチやファイルの一覧のように、その時々で変わる選択肢を作れる。

`options: "workspace"`は、ワークスペースの一覧を名前で選ぶ欄になる。デフォルトでは今のワークスペースが選ばれた状態で開く。

入力画面を開いたときは、先頭の欄にカーソルがある。別の欄から入力したいときは、その欄に`focus: true`を書く。

| 項目          | 内容                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`       | 欄の見出し。省略すると`{{name}}`の名前                                                                                                            |
| `placeholder` | 自由に入力する欄に薄く表示する入力例                                                                                                              |
| `options`     | 選択肢。配列・`"workspace"`・関数のどれか。省略すると自由に入力する欄                                                                             |
| `default`     | 開いたときに入っている値。関数も書ける（[開くたびに初期値を決める](#開くたびに初期値を決める)）。選択肢の欄では、選択肢にある値のときだけ使われる |
| `focus`       | `true`にすると、開いたときにこの欄にカーソルがある。デフォルトは先頭の欄                                                                          |
| `quote`       | 値をクォートするか。デフォルトは`true`（[値のクォート](#値のクォート)）                                                                           |

## 開くたびに初期値を決める

`default`に関数を書くと、入力画面を開くたびに呼ばれ、返した文字列が初期値になる。引数は`options`の関数と同じ`tab`と`niwa`。`undefined`を返すと初期値なしになる。

次の例は、クリップボードにブランチ名らしい文字列が入っていれば、それを初期値にする。

```ts
branch: {
  label: "ブランチ名",
  focus: true,
  default: async (tab, niwa) => {
    const text = (await niwa.clipboard.read()).trim();
    return /^[\w./-]+$/.test(text) ? text : undefined;
  },
},
```

選択肢の欄では、`options`の関数で選択肢を作り終えてから`default`の関数が呼ばれる。返した値が選択肢に無ければ、先頭の選択肢が選ばれた状態で開く。`rememberLastValues: true`のテンプレートでは、前回の値が`default`より優先される。

## 値のクォート

デフォルトでは、空白や記号を含む値を`'...'`で囲んでからコマンドに入れる。`project red.csv`と入力すると`'project red.csv'`になり、1つの引数として渡る。英数字と`-`・`/`・`.`などだけの値は、そのまま入る。

`-v --dry-run`のように複数の引数をまとめて入れたい欄や、`~`を展開させたい欄は、`quote: false`にする。値の中の`'`の囲み方はzshやbashの書き方なので、PowerShellのタブで`'`を含む値を使うときも`quote: false`にして自分で書く。

## 前回の値を覚えておく

`rememberLastValues: true`にすると、前回送った値が次に開いたときの初期値になる。日付のように、毎回少しだけ変える値に向いている。値はniwatermを再起動しても残る。

```ts
{
  name: "期間を決めて集計",
  command: "foo --from {{from}} --to {{to}} --file {{file}}",
  rememberLastValues: true,
},
```

## 設定項目の一覧

| 項目                 | デフォルト     | 内容                                                                        |
| -------------------- | -------------- | --------------------------------------------------------------------------- |
| `name`               | （必須）       | 入力画面の見出しと、コマンドパレットに表示する名前                          |
| `command`            | （必須）       | 差し替える部分を`{{name}}`で書いたコマンド。同じ名前を2回書くと同じ値が入る |
| `id`                 | `name`から作る | `niwa.commandTemplate.open(id)`で指す名前                                   |
| `description`        | なし           | 入力画面の見出しの下に表示する説明                                          |
| `fields`             | なし           | [入力欄の設定](#入力欄の種類fields)                                         |
| `rememberLastValues` | `false`        | [前回の値を初期値にする](#前回の値を覚えておく)                             |
