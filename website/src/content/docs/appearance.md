---
title: 外観
description: フォント・配色・タイルの見た目・背景の透過・タイトルバーの設定
---

フォントや配色、タイルの並び方、背景の透け具合といった見た目は、設定ファイルの`appearance`で変える。変えたい項目だけを書けばよく、書いていない項目はデフォルトのまま使われる。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  appearance: {
    theme: "tokyo-night",
    fontFamily: '"HackGen Console NF", monospace',
    fontSize: 14,
    background: "#101010",
  },
});
```

保存するとすぐに反映される。ただし、背景の透過（`backgroundOpacity`）とタイトルバー（`titleBar`）だけは、niwatermを起動し直したときに反映される。

## テーマ

`theme`に名前を書くと、配色をまとめて切り替えられる。選べるテーマは次の7つ。

| 名前                 | テーマ           | 背景   |
| -------------------- | ---------------- | ------ |
| `"catppuccin-mocha"` | Catppuccin Mocha | 暗い   |
| `"tokyo-night"`      | Tokyo Night      | 暗い   |
| `"dracula"`          | Dracula          | 暗い   |
| `"nord"`             | Nord             | 暗い   |
| `"gruvbox-dark"`     | Gruvbox Dark     | 暗い   |
| `"gruvbox-light"`    | Gruvbox Light    | 明るい |
| `"solarized-light"`  | Solarized Light  | 明るい |

何も書かなければCatppuccin Mochaになる。

テーマが決めるのは、ターミナルの文字・背景・カーソル・16色と、枠やバッジの色。`foreground`や`ui`などを一緒に書けば、その色だけ変えられる。上の例では、Tokyo Nightの配色のまま背景だけを`#101010`にしている。

## フォントと文字の色

`fontFamily`には、CSSの`font-family`と同じ書き方でフォント名を並べる。空白を含むフォント名は`"HackGen Console NF"`のように引用符で囲む。

`fontSize`と`lineHeight`はピクセルで指定する。prefix + `=` / `-`で文字を大きく・小さくすると、行の高さも同じ割合で変わる。

`foreground`・`background`は文字の色と背景の色。サイドバーやコマンドパレットの色も、この2色から作られる。

`cursor`はカーソルの色。カーソルの上の文字は`background`の色になる。

ターミナルの16色は`ansiColors`で変える。0〜7番が通常の色。8〜15番が明るい色。一部の色だけ変えるときは、変えない番号に`undefined`を書く。`undefined`の番号はテーマの色のまま使われる。

```ts
appearance: {
  // 1番（赤）だけを変える
  ansiColors: [undefined, "#ff5555"],
},
```

## 枠やバッジの色

タイルの枠や境界線、コピーモードのカーソルといった、ターミナルの文字以外の色は`ui`で変える。色は「強調」「警告」のような役割ごとに決まっていて、同じ役割のものは同じ色になる。

```ts
appearance: {
  ui: {
    accent: "#7aa2f7",
    border: "#2a2a2a",
  },
},
```

| 項目              | デフォルト | 使われる場所                                                                                                                   |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `border`          | `#313244`  | サイドバーやタブバーの境界線、フォーカスしていないタイルの枠                                                                   |
| `accent`          | `#89b4fa`  | フォーカス中のタイルの枠、コピーモードの選択範囲、サイドバーのエージェント作業中の表示                                         |
| `warning`         | `#f9e2af`  | ズーム中のタイルの枠、検索で見つかった箇所、コピーモードのカーソル、ジャンプヒントのラベル、ベルやエージェントの入力待ちの表示 |
| `success`         | `#a6e3a1`  | コピーしたときのバッジ                                                                                                         |
| `danger`          | `#f38ba8`  | 検索で見つからなかったときなどのメッセージ                                                                                     |
| `badgeForeground` | `#1e1e2e`  | 上の4色を背景にしたバッジの文字色                                                                                              |
| `scrollbar`       | `#45475a`  | スクロールバー                                                                                                                 |

表のデフォルトはCatppuccin Mochaの色。`theme`を変えると、そのテーマの色になる。

テーマを使わずに明るい配色を自分で作るときは、`accent`と`warning`も暗めの色に変える。特に`warning`はタイルの枠にも使うので、明るい色のままだとほとんど見えない。

## タイルの見た目

タイルは角の丸い枠で囲まれ、少し隙間をあけて並ぶ。隙間を広げて影を付け、フォーカスしていないタイルを暗くすると、カードを並べたような見た目になる。

```ts
appearance: {
  tileGap: 6,
  tileShadow: "0 1px 4px rgba(0, 0, 0, 0.4)",
  inactiveTileDim: 0.2,
},
```

角を丸めたくなければ`tileBorderRadius: 0`にする。ブラウザタブとカスタムビューのタブは、`inactiveTileDim`を指定しても暗くならない。

タイルを分割すると、新しいタイルが横（または下）へ広がるように現れる。すぐに切り替わるほうがよければ`tileAnimation: false`にする。

## タブが1つのときのタブバー

タブが1つしかないタイルでは、タブバーを出さずに、その分ターミナルを1行広く使う。タブバーは、マウスをタイルの上端に当てているあいだだけ現れる。タブが2つ以上になると、いつも表示される。

タブが1つでもタブバーをいつも出しておきたいときは、`tabBar: "always"`にする。

```ts
appearance: {
  tabBar: "always",
},
```

## ポップアップのツールバー

ポップアップの上には、タブへ昇格・最小化・閉じるのボタンが並んだツールバーがある。`popupToolbar: "hover"`にすると、ふだんはツールバーを隠して、その分ターミナルを1行広く使う。ツールバーは、マウスをポップアップの上端に当てているあいだだけ現れる。

```ts
appearance: {
  popupToolbar: "hover",
},
```

ポップアップを動かすときは、上端にマウスを当ててツールバーを出してから、ボタンのない所をドラッグする。

## 背景を透かす・画像を表示する

`backgroundOpacity`を1より小さくすると、背景が透けて後ろのウィンドウが見える。`backgroundImage`には、グラデーションや画像ファイルを指定できる。

```ts
appearance: {
  backgroundOpacity: 0.85,
  backgroundImage: "linear-gradient(135deg, rgba(137, 180, 250, 0.3), transparent)",
  // 画像ファイルのパスも指定できる
  // backgroundImage: "/home/user/pictures/wall.png",
},
```

- `backgroundOpacity`を変えたら、niwatermを起動し直す
- vimなどのアプリが色を塗った部分と、ポップアップは透けない
- 画像はpng・jpg・gif・webp・avif・bmp・svgを使える

## タイトルバーを隠す

`titleBar: "hidden"`にすると、OSのタイトルバーを隠して、その分を画面に使える。変えたら、niwatermを起動し直す。

```ts
appearance: {
  titleBar: "hidden",
},
```

タイトルバーがないあいだ、ウィンドウは次のように操作する。

- **移動** — サイドバーの一番上の[ツールバー](/niwaterm/sidebar-toolbar/)の、ボタンがないところをドラッグする
- **最小化・最大化・閉じる** — OSのショートカットを使う。Windowsなら<kbd>Win</kbd>+<kbd>↓</kbd>・<kbd>Win</kbd>+<kbd>↑</kbd>・<kbd>Alt</kbd>+<kbd>F4</kbd>。macOSではウィンドウの左上のボタンがそのまま残る
- **大きさを変える** — ウィンドウの端をドラッグする。いつもどおりできる

Windowsでは、ドラッグで画面の端に寄せてウィンドウを並べる機能（スナップ）と、ダブルクリックでの最大化は使えない。

## 設定項目の一覧

| 項目                | デフォルト                 | 内容                                                                                  |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `theme`             | `"catppuccin-mocha"`       | [テーマ](#テーマ)の名前                                                               |
| `fontFamily`        | `"HackGen Console NF"`など | フォント。CSSの`font-family`と同じ書き方                                              |
| `fontSize`          | `13`                       | 文字の大きさ（ピクセル）                                                              |
| `lineHeight`        | `18`                       | 行の高さ（ピクセル）                                                                  |
| `foreground`        | `"#cdd6f4"`                | 文字の色                                                                              |
| `background`        | `"#1e1e2e"`                | 背景の色                                                                              |
| `cursor`            | `"#f5e0dc"`                | カーソルの色                                                                          |
| `ansiColors`        | —                          | ターミナルの16色                                                                      |
| `ui`                | —                          | [枠やバッジの色](#枠やバッジの色)                                                     |
| `tileBorderRadius`  | `6`                        | タイルの角の丸み（ピクセル）                                                          |
| `tileGap`           | `4`                        | タイルどうしの隙間と、タイルと画面の端の隙間（ピクセル）                              |
| `tileShadow`        | `"none"`                   | タイルの影。CSSの`box-shadow`と同じ書き方                                             |
| `inactiveTileDim`   | `0`                        | フォーカスしていないタイルを暗くする度合い（0〜1）                                    |
| `tileAnimation`     | `true`                     | タイルを分割したときに広がるアニメーションを付けるか                                  |
| `tabBar`            | `"auto"`                   | タブが1つのときのタブバー。`"auto"`か`"always"`                                       |
| `popupToolbar`      | `"always"`                 | ポップアップのツールバー。`"always"`か`"hover"`                                       |
| `backgroundOpacity` | `1`                        | 背景の不透明度（0〜1）。起動し直すと反映される                                        |
| `backgroundImage`   | `"none"`                   | 背景のグラデーションや画像。CSSの`background-image`と同じ書き方か、画像ファイルのパス |
| `titleBar`          | `"default"`                | タイトルバーを出すか。`"default"`か`"hidden"`。起動し直すと反映される                 |

書いた値が正しくない項目は、その項目だけデフォルトに戻る。何を戻したかは[今の設定の表示](/niwaterm/getting-started/#現在の設定値を確認する)で確かめられる。
