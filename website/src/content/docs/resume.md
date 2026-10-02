---
title: 実行中だったコマンドの打ち直し
description: 終了したときにタブで動いていたnvimやclaudeなどのコマンドを、次に起動したときに打ち直す設定と、Boardごとの切り替え
---

niwatermを終了したときにタブで動いていたコマンドを、次に起動したときに同じタブへ打ち直せる。`nvim foo.md`でファイルを開いたまま終了しても、次に起動すればまた`nvim foo.md`が開く。

打ち直すのは、設定ファイルの`resume.allow`に書いたコマンドだけ。**デフォルトでは何も打ち直さない**ので、使うときは打ち直してよいコマンドを書き足す。

```ts
resume: {
  allow: ["nvim", "claude", "lazygit", "git log"],
},
```

使うには[シェル統合](/niwaterm/shell-integration/)が必要になる。シェル統合が、いま動いているコマンドをniwatermへ知らせている。

打ち直すのはコマンドの入力だけで、プログラムの中の状態（保存していない編集やスクロールバック）は戻らない。コマンドはシェルへ入力されるので、終了すればシェルに戻り、履歴にも残る。打ち直すのは、そのBoardを最初に表示したときになる。

## 打ち直すコマンドを決める

`resume.allow`には、打ち直してよいコマンドを単語単位で書く。書いた単語で始まるコマンドが対象になる。

- `"nvim"`は`nvim foo.md`に当てはまるが、`nvimdiff`には当てはまらない
- `"claude"`は`claude --continue`に当てはまる
- `"git log"`は`git log --oneline`に当てはまるが、`git status`には当てはまらない

`CLAUDE_CONFIG_DIR=~/.claude-work claude`のように先頭で環境変数を指定したコマンドは、環境変数を除いた部分で判定する。打ち直すときは、環境変数も含めて元のとおりに入力する。

`allow`に書いても、次のコマンドは打ち直さない。

- `;`・`&&`・`|`・`$(...)`・リダイレクト（`>`など）を含むコマンドや、複数行のコマンド
- `rm`・`mv`・`sudo`・`kill`・`git push`・`git reset`・`npm publish`のような、打ち直すと危ないコマンド。コマンドの途中に含まれていても（`watch rm -rf build`など）打ち直さない

エイリアスや関数の中身までは確かめない。`allow`に書くエイリアス・関数は、打ち直しても困らないものだけにする。

## Boardごとに切り替える

デフォルトでは、どのBoardでも打ち直す（`allow`に書いたコマンドだけ）。全体で止めるときは`enabled`を`false`にする。

```ts
resume: {
  enabled: false,
  allow: ["nvim"],
},
```

Boardごとの切り替えは、設定ファイルより優先される。「このBoardだけ打ち直さない」「全体では止めているが、このBoardだけ打ち直す」ときに使う。

### サイドバーから切り替える

サイドバーのBoardを右クリックして、「実行中コマンドの打ち直し」から選ぶ。

- **設定に従う** — 設定ファイルの指定どおりにする（デフォルト）
- **打ち直す** / **打ち直さない** — このBoardだけ、設定ファイルにかかわらずそうする

### CLIから切り替える

```sh
# このBoardでは打ち直さない
niwa board resume set off
# 設定に従う状態へ戻す
niwa board resume clear
# 今の切り替えを表示する
niwa board resume show
```

`--board <boardId>`で対象のBoardを選べる。省略すると今のBoardが対象になる。`board resume show`は`on`か`off`を表示し、切り替えていない（設定に従う）ときは空行を表示する。

## 起動時レイアウトのBoard

[起動時レイアウト](/niwaterm/layouts/#起動時レイアウト)を紐づけたBoardは、デフォルトでは打ち直さず、プリセットの`command`を実行する。`resume.enabled`の指定は関係しない。

プリセットのタブに`resume: true`を書くと、そのタブで前回動いていたコマンドを`command`の代わりに打ち直す。打ち直すコマンドが無いとき（前回はプロンプトに戻っていた、`allow`に無い、など）は`command`を実行する。

```ts
layouts: {
  dev: {
    layout: {
      kind: "split",
      orientation: "vertical",
      first: { kind: "tile", tabs: [{ name: "editor", command: "nvim", resume: true }] },
      second: { kind: "tile", tabs: [{ name: "server", command: "npm run dev" }] },
    },
  },
},
```

この例では、前回`nvim src/app.ts`を開いたまま終了していれば、次に起動したときも`nvim src/app.ts`が開く。サーバーのタブはいつもどおり`npm run dev`を実行する。

プリセット全体に`resume: true`を書くと、すべてのタブのデフォルトになる。タブに`resume: false`を書けば、そのタブだけ外せる。

Boardごとの切り替えは、起動時レイアウトのBoardでも優先される。`打ち直す`にしたBoardでは`resume`を書いていないタブも打ち直し、`打ち直さない`にしたBoardでは`resume: true`のタブも`command`を実行する。

## 記録されないコマンド

先頭に空白を付けて実行したコマンドは、記録しない。履歴に残したくないコマンドと同じ扱いになる。

bashでは、履歴に残らなかったコマンドは記録しない。`HISTCONTROL`に`ignoredups`を入れていると、直前と同じコマンドを続けて実行したときも記録されない。

打ち直されないときは、そのタブの[シェル統合](/niwaterm/shell-integration/#更新と困ったとき)が新しいものになっているかを確かめる。今の設定は`niwa config show`の`resume`の欄で確かめられる。
