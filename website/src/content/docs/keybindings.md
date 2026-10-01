---
title: キーバインド
description: prefixキーのあとに押すキーバインドとデフォルトのキー一覧、設定ファイルでの割り当て方
---

niwatermのキー操作は**prefix方式**で行う。prefixキー（デフォルトは`ctrl+b`）を押して離し、続けてもう1つキーを押す。たとえば`ctrl+b`→`d`でタイルを左右に分割する。prefixキーを押したあとでやめたいときは`Escape`を押す。

コピーとペーストだけは、prefixなしで押せる。macOSは`cmd+c` / `cmd+v`、Windowsは`ctrl+shift+c` / `ctrl+shift+v`を使う。

## デフォルトのキー

prefixキーのあとに押すキーの一覧。キーが割り当てられていない操作も、prefix + `:`で開くコマンドパレットから名前で探して実行できる。

| キー                             | 動作                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `d` / `shift+d`                  | タイルを左右 / 上下に分割する                                                                     |
| `w`                              | フォーカス中のタブを閉じる（最後のタブならタイルごと閉じる）                                      |
| `up` / `down` / `left` / `right` | 隣のタイルへフォーカスを移す                                                                      |
| `z`                              | フォーカス中のタイルだけを画面いっぱいに広げる。もう一度押すと戻る                                |
| `t` / `shift+t`                  | ターミナル / [ブラウザ](/niwaterm/browser/)のタブを開く                                           |
| `n` / `p`                        | 次 / 前のタブへ切り替える                                                                         |
| `r`                              | タブの名前を変える                                                                                |
| `u`                              | ブラウザタブのURL欄へフォーカスする                                                               |
| `c`                              | [Board](/niwaterm/boards/)を追加する                                                              |
| `,`                              | Boardの名前を変える                                                                               |
| `shift+n`                        | ワークスペースを追加する                                                                          |
| `]` / `[`                        | 次 / 前のワークスペースへ切り替える                                                               |
| `shift+w`                        | 新しいウィンドウを開く                                                                            |
| `b`                              | サイドバーを表示する / 隠す                                                                       |
| `shift+b`                        | サイドバーに出す[カスタムビュー](/niwaterm/custom-views/)を切り替える                             |
| `` ` ``                          | ポップアップを開く / 閉じる                                                                       |
| `f`                              | [ジャンプヒント](/niwaterm/jump-and-copy/#ジャンプヒント)を出す                                   |
| `v`                              | [コピーモード](/niwaterm/jump-and-copy/#コピーモードvi風のキーボード選択)に入る                   |
| `shift+up` / `shift+down`        | 前 / 次のプロンプトへ飛ぶ（[シェル統合](/niwaterm/shell-integration/)が必要）                     |
| `pageup` / `pagedown`            | 1ページ分スクロールする                                                                           |
| `home` / `end`                   | スクロールバックの先頭 / 最新の行へ飛ぶ                                                           |
| `=` / `-` / `0`                  | 文字を大きく / 小さく / 元の大きさにする                                                          |
| `:`                              | コマンドパレットを開く                                                                            |
| `i`                              | 今の設定を表示する（[現在の設定値を確認する](/niwaterm/getting-started/#現在の設定値を確認する)） |

今の割り当ては`niwa keybind list`で一覧できる。

## キーの割り当てを変える

`niwaterm.config.ts`の`keybindings`に、`niwa.keybind(キー, 動作)`を並べる。デフォルトのキーは最初から登録されているので、変えたいキーと足したいキーだけを書けばよい。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    // prefix + d を上下分割に変える
    niwa.keybind("d", "split-horizontal");
    // prefix + m でlazygitをポップアップで開く
    niwa.keybind(
      "m",
      () => {
        niwa.popup.open({ width: 80, height: 80, command: "lazygit" });
      },
      { description: "lazygitをポップアップで開く" },
    );
    // prefix + z の割り当てを外す
    niwa.unbind("z");
  },
});
```

2つ目の引数には、動作の名前（`"split-horizontal"`など）か関数を渡す。動作の名前は[アクション一覧](/niwaterm/keybindings/actions/)にある。関数の中では`niwa.popup.open`のようなniwatermの操作を呼べるほか、if文で条件を分けたりコマンドを実行したりと、TypeScriptで好きな処理を書ける。関数から呼べる操作は[niwa API](/niwaterm/keybindings/api/)にまとめてある。3つ目の引数の`description`は、キーの一覧に出す説明（[一覧に説明を出す](#一覧に説明を出す)）。

関数はキーを押したときに呼ばれる。そのため、`niwa.tile.current()`のような今の状態を取る関数は、押した時点の状態を返す。

### prefixキーを変える

prefixキーは`niwa.prefix`で変えられる。

```ts
keybindings: (niwa) => {
  niwa.prefix("ctrl+a");
},
```

### prefixなしで押せるキーを作る

`noPrefix: true`を付けると、prefixキーを押さずにそのキーだけで動くようになる。キーには`cmd`・`ctrl`・`alt`のどれかを含める。

```ts
niwa.keybind("alt+h", "focus-left", { noPrefix: true });
```

割り当てたキーはniwatermが受け取り、シェルやアプリには届かなくなる。`alt+b`（単語単位でカーソルを戻す）のようにシェルで使うキーや、macOSで`option`を使って入力する特殊文字と重ならないように選ぶ。

### 続けて押せるようにする

`repeat: true`を付けたキーは、一度押したあと少しのあいだ、prefixなしで何度でも押せる。タイルの大きさを少しずつ変えたいときに便利。

```ts
keybindings: (niwa) => {
  niwa.keybind("h", "resize-left", { repeat: true });
  niwa.keybind("j", "resize-down", { repeat: true });
  niwa.keybind("k", "resize-up", { repeat: true });
  niwa.keybind("l", "resize-right", { repeat: true });
},
```

この例なら、`ctrl+b`→`h`→`h`→`j`のように続けて押せる。`repeat`を付けたキーどうしなら、別のキーに移っても続けられる。続けて押せる時間はデフォルトで500ミリ秒で、`niwa.repeatTimeout(300)`のように変えられる。

### 一覧に説明を出す

`niwa keybind list`の一覧には、関数を割り当てたキーは`function`としか出ない。`description`を付けておくと、その説明が出る。

```ts
niwa.keybind(
  "g",
  () => {
    niwa.popup.open({ width: 90, height: 90, command: "lazygit" });
  },
  { description: "lazygitをポップアップで開く" },
);
```

### 設定を複数のファイルに分ける

キーバインドが増えてきたら、`niwa`を受け取る関数を別ファイルに書き、`niwaterm.config.ts`から呼ぶ。分けたファイルを保存したときも、設定はすぐに反映される。

```ts
// keymaps.ts
import type { Niwa } from "@niwaterm/config";

export function applyTileKeymaps(niwa: Niwa): void {
  niwa.keybind("d", "split-horizontal");
}

// niwaterm.config.ts
import { defineConfig } from "@niwaterm/config";
import { applyTileKeymaps } from "./keymaps";

export default defineConfig({
  keybindings: (niwa) => {
    applyTileKeymaps(niwa);
  },
});
```

## キーの書き方

キーは`shift+d`のように、修飾キーとキーを`+`でつないで書く。修飾キーは`cmd`・`ctrl`・`shift`・`alt`の4つ。矢印キーは`up`・`down`・`left`・`right`、Page Up・Page Down・Home・Endキーは`pageup`・`pagedown`・`home`・`end`と書く。

- **prefixのあとに押すキー**には、`shift`と`alt`だけを付けられる。`ctrl`や`cmd`を付けたキーは割り当てられない
- **prefixキーと`noPrefix`のキー**には、`cmd`・`ctrl`・`alt`のどれかを含める
- **`|`や`:`のようにShiftを押して打つ記号**は、`shift+`を付けずにその記号をそのまま書く（`niwa.keybind("|", ...)`）。英字は`d`と`shift+d`を区別する
- **macOSで`alt`（Option）を使うとき**は、英字と数字のキーなら`alt+n`のように書けば動く。`alt+;`のような記号のキーは、キーボード配列によっては反応しないことがある
- **macOSのJIS配列で`\`を割り当てたとき**は、`option+¥`で打つか、入力ソースの設定で`¥`キーの入力を`\`に変える

書き方を間違えたキーや、存在しないアクションの名前を書いた場合は、その行だけが無視される。何を無視したかは[今の設定の表示](/niwaterm/getting-started/#現在の設定値を確認する)の「無視した設定」に出る。
