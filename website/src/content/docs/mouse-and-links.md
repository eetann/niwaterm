---
title: マウスとリンク
description: マウス操作と選択範囲の右クリックメニュー、URLの検出と開き方の設定
---

マウスで選択・クリックしたときの挙動と、画面上のURLを見つけて開く処理を設定する。

## マウス設定

`mouse`はマウス操作の挙動を指定するオブジェクト。

| フィールド      | 型         | 意味                                                                                                   |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `copyOnSelect`  | `boolean`  | マウスでのテキスト選択が終わった時点で、選択範囲をクリップボードへ自動コピーする。未指定時は`false`    |
| `selectionMenu` | `function` | 選択範囲を右クリックした時のメニューに並べる項目を組み立てる。未指定時は組み込みの「コピー」だけが出る |

```ts
mouse: {
  copyOnSelect: true,
},
```

`copyOnSelect`が拾うのはターミナル出力の中で完結した選択だけで、サイドバーやコマンドパレットの文字列を選択してもクリップボードは書き換わらない。コピー後も選択はそのまま残る。TUIアプリがマウスを掴んでいる間（マウスレポート有効時）はドラッグがアプリ側へ渡るため、Shiftを押しながらドラッグして選択する。

コピーが成立すると、そのターミナルの右上に`COPIED · 2行`のようなバッジが1.5秒だけ出る。この表示は`copyOnSelect`専用ではなく、`ctrl+shift+c`（`copy-selection`）・コピーモードの`y`でも共通に出る。一方、ターミナル上のアプリがOSC 52で書き込んだぶん（vimのyank等）はユーザー操作ではないためバッジを出さない。

不正な値（真偽値以外）を指定した場合、警告付きで`false`にフォールバックする。

### 選択範囲の右クリックメニュー（selectionMenu）

ターミナル出力を選択した状態で右クリックすると、その選択範囲に対するメニューが出る。メニューの先頭には常に組み込みの「コピー」があり、その下に`selectionMenu`が返した項目が並ぶ。選択が無い状態の右クリックではメニューを出さない（マウスレポート中のTUIアプリにはこれまで通り右クリックがそのまま渡る）。

`selectionMenu`は右クリックのたびに呼ばれる関数で、開くコマンドの出し分け（拡張子・OS・cwd）は素のif文で書ける。

```ts
mouse: {
  selectionMenu: (selection, niwa) => {
    const path = selection.text.trim();
    const items = [];
    if (/\.(png|jpe?g|gif|svg)$/.test(path)) {
      items.push({
        label: "画像を開く",
        run: () => niwa.shell.run(`qlmanage -p '${path}'`, { cwd: selection.cwd }),
      });
    }
    items.push({
      label: process.platform === "win32" ? "エクスプローラで開く" : "openで開く",
      run: () => {
        const opener = process.platform === "win32" ? "explorer.exe" : "open";
        return niwa.shell.run(`${opener} '${path}'`, { cwd: selection.cwd });
      },
    });
    return items;
  },
},
```

第1引数には選択範囲の情報が渡る。

| フィールド | 型                    | 意味                                                                                         |
| ---------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `text`     | `string`              | 選択されているテキスト                                                                       |
| `tabId`    | `string`              | 選択があるタブのid                                                                           |
| `cwd`      | `string \| undefined` | そのタブが報告している作業ディレクトリ。シェル統合（OSC 7）を入れていないタブでは`undefined` |

第2引数は[キーバインドの関数ハンドラ](/niwaterm/keybindings/#関数ベースapi推奨)と同じ`niwa`で、`niwa.shell.run`・`niwa.popup.open`・`niwa.tab.create`・`niwa.notify`等をそのまま呼べる。返す項目は`label`（メニューの表示名）と`run`（選んだ時の処理）を持つオブジェクトで、`run`は非同期でもよい。空配列を返せば組み込みの「コピー」だけのメニューになる。

関数はniwaterm本体（bun側）で実行されるため、`process.platform`でのOS判定・`Bun.spawn`・`node:fs`の読み書きも書ける。選択テキストは`niwa.shell.run`でシェルへ渡るため、パスに空白や記号が入りうるならクォートする。

関数が例外を投げた場合・配列以外を返した場合・`label`や`run`を欠く項目は、警告付きで無視される（メニュー自体は組み込みの項目だけで開く）。

相対パスを開くには`cwd`が要るので、シェル統合（`contrib/shell-integration/`）を入れておくと扱いやすい。

## リンク設定

ターミナル出力の中のURLは、**修飾キーを押しながらクリック**すると開ける。修飾キーを押している間だけ、マウスが乗っているURLに下線が出る。

対象は2種類。

- **OSC 8ハイパーリンク**: プログラムが明示的にリンクとして出力したもの（`gh`・`eza --hyperlink`等）。表示テキストとURLが違うことがある
- **素のURL**: `link.rules`の正規表現で画面の文字列から見つけたもの。ただの`https://...`という出力がそのままクリックできる

修飾キーを要求するのは、TUIアプリへのマウス操作の転送・テキスト選択と同じ左クリックを取り合わないため。修飾キーを押しながらのクリックはリンクの上でだけ横取りされ、リンクが無い場所ではこれまで通りアプリ側・選択側へ渡る。

| フィールド | 型                                    | 意味                                                                                                |
| ---------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `modifier` | `"cmd" \| "ctrl" \| "alt" \| "shift"` | リンクを開くのに押しておく修飾キー。未指定時はmacOSが`cmd`、Windowsが`ctrl`                         |
| `open`     | `"external" \| "browser-tab"`         | 開き先。`external`はOS既定のブラウザ、`browser-tab`はniwaterm内のブラウザタブ。未指定時は`external` |
| `rules`    | `LinkRule[]`                          | 素のURLとみなすパターン。指定すると既定のルールを**置き換える**（追加ではない）                     |

```ts
link: {
  modifier: "alt",
  open: "browser-tab",
},
```

macOSの既定が`cmd`なのは、macOSではctrl+クリックがOSレベルで右クリック扱いになりリンクを開く操作に使えないため（iTerm2・Terminal.appと同じ）。

`open: "browser-tab"`にすると、クリックしたタブと同じタイルへブラウザタブが足される。`mailto:`のようにブラウザタブで扱えないURLはこの設定でも外部で開く。

### URLとみなすパターン（`link.rules`）

各ルールは`regex`（正規表現。`RegExp`でも文字列でもよい）と`format`（マッチから開くURLを組み立てるテンプレート。`$0`がマッチ全体、`$1`以降がキャプチャ。省略時は`$0`）を持つ。

既定では次の3つが有効。

| パターン                             | 開くURL                   |
| ------------------------------------ | ------------------------- |
| `https?://...`                       | マッチした文字列そのもの  |
| `mailto:...`                         | マッチした文字列そのもの  |
| メールアドレス（`user@example.com`） | `mailto:`を頭に付けたもの |

URLの直後に置かれただけの句読点・閉じ括弧（`.` `,` `)` 等）はマッチに含めない。

チケット番号のような独自の記法をリンクにしたい場合は、既定のルールごと書き直す。

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

`defaultLinkRules`は設定ファイルに書くのと同じ形（`{ regex, format }`）で公開しているので、上のように既定へ足す書き方でそのまま混ぜられる。ルールは先に書いたものが優先で、クリック位置を含むマッチが最初に見つかったルールが使われる。

素のURLの検出を止めてOSC 8のリンクだけを残したい場合は`rules: []`を指定する。

実際に開けるスキームは`http` / `https` / `mailto`に限られる（PTY越しの出力はリモートホスト由来のこともあるため、`file:`・`javascript:`等は開かない）。ルールで他のスキームを拾っても開く直前に弾かれるので、その場合は`format`で開けるURLへ組み替える。

パターンは1行ずつに当てるため、**折り返して2行にまたがったURLは検出できない**（OSC 8のリンクは折り返しても1つのリンクとして扱われる）。

正規表現として不正なルールは警告付きで無視され、残りのルールで動く。書いたルールが全滅した場合だけ既定のルールへ戻る。

### 開く処理を差し替える（`niwa.on("open-link", ...)`）

`keybindings`の関数の中で`niwa.on("open-link", handler)`を呼ぶと、**`link.open`の処理の代わりに**そのハンドラが走る。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    niwa.on("open-link", (event) => {
      // 社内のリンクだけniwaterm内のブラウザタブで開き、他は外部ブラウザへ渡す
      if (event.url.startsWith("https://internal.example.com/")) {
        niwa.tab.create();
        return;
      }
      niwa.link.openExternal(event.url);
    });
  },
});
```

`link.open`の設定どおりの処理へ戻したいときは`niwa.link.default(event)`を呼ぶ。

ハンドラは`async`にでき、`niwa`のAPI（`shell.run`・`notify`・`popup.open`等）をそのまま使える。

ハンドラに渡る値（`NiwaLinkEvent`）は次の通り。

| フィールド         | 型                    | 意味                                                                                         |
| ------------------ | --------------------- | -------------------------------------------------------------------------------------------- |
| `url`              | `string`              | 開こうとしているURL（`format`を適用した後の値）                                              |
| `text`             | `string`              | 画面上でマッチした文字列そのもの。`format`でURLへ組み替えた場合は元の見た目が残る            |
| `tabId` / `tileId` | `string`              | クリックされたタブとその所在                                                                 |
| `cwd`              | `string \| undefined` | そのタブが報告している作業ディレクトリ。シェル統合（OSC 7）を入れていないタブでは`undefined` |

`niwa.link`のメソッドは2つ。

| メソッド            | 意味                                                  |
| ------------------- | ----------------------------------------------------- |
| `default(event)`    | `link.open`の設定に従って開く（既定の処理と同じもの） |
| `openExternal(url)` | `link.open`の設定に関わらずOS既定のブラウザで開く     |
