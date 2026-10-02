---
title: 起動時にコマンドを再実行
description: 終了したときにタブで動いていたnvimやclaudeなどのコマンドを、次に起動したときに再実行する設定と、Boardごとの切り替え
---

niwatermを終了したときにタブで動いていたコマンドを、次に起動したときに同じタブで再実行できる。`nvim foo.md`でファイルを開いたまま終了しても、次に起動すればまた`nvim foo.md`が開く。

再実行するのは、設定ファイルの`resume.allow`に書いたコマンドだけ。**デフォルトでは何も再実行しない**ので、使うときは再実行してよいコマンドを書き足す。

```ts
resume: {
  allow: ["nvim", "claude", "lazygit", "git log"],
},
```

使うには[シェル統合](/niwaterm/shell-integration/)が必要になる。シェル統合が、いま動いているコマンドをniwatermへ知らせている。

同じコマンドをもう一度入力するだけで、プログラムの中の状態（保存していない編集やスクロールバック）は戻らない。コマンドはシェルへ入力されるので、終了すればシェルに戻り、履歴にも残る。再実行するのは、そのBoardを最初に表示したときになる。

## 再実行するコマンドを決める

`resume.allow`には、再実行してよいコマンドを単語単位で書く。書いた単語で始まるコマンドが対象になる。

- `"nvim"`は`nvim foo.md`に当てはまるが、`nvimdiff`には当てはまらない
- `"claude"`は`claude --continue`に当てはまる
- `"git log"`は`git log --oneline`に当てはまるが、`git status`には当てはまらない

`CLAUDE_CONFIG_DIR=~/.claude-work claude`のように先頭で環境変数を指定したコマンドは、環境変数を除いた部分で判定する。再実行するときは、環境変数も含めて元のとおりに入力する。

`allow`に書いても、次のコマンドは再実行しない。

- `;`・`&&`・`|`・`$(...)`・リダイレクト（`>`など）を含むコマンドや、複数行のコマンド
- `rm`・`mv`・`sudo`・`kill`・`git push`・`git reset`・`npm publish`のような、再実行すると危ないコマンド。コマンドの途中に含まれていても（`watch rm -rf build`など）再実行しない

エイリアスや関数の中身までは確かめない。`allow`に書くエイリアス・関数は、再実行しても困らないものだけにする。

## Boardごとに切り替える

デフォルトでは、どのBoardでも再実行する（`allow`に書いたコマンドだけ）。全体で止めるときは`enabled`を`false`にする。

```ts
resume: {
  enabled: false,
  allow: ["nvim"],
},
```

Boardごとの切り替えは、設定ファイルより優先される。「このBoardだけ再実行しない」「全体では止めているが、このBoardだけ再実行する」ときに使う。

### サイドバーから切り替える

サイドバーのBoardを右クリックして、「起動時にコマンドを再実行」から選ぶ。

- **設定に従う** — 設定ファイルの指定どおりにする（デフォルト）
- **再実行する** / **再実行しない** — このBoardだけ、設定ファイルにかかわらずそうする

### CLIから切り替える

```sh
# このBoardでは再実行しない
niwa board resume set off
# 設定に従う状態へ戻す
niwa board resume clear
# 今の切り替えを表示する
niwa board resume show
```

`--board <boardId>`で対象のBoardを選べる。省略すると今のBoardが対象になる。`board resume show`は`on`か`off`を表示し、切り替えていない（設定に従う）ときは空行を表示する。

## 起動時レイアウトのBoard

[起動時レイアウト](/niwaterm/layouts/#起動時レイアウト)を紐づけたBoardは、デフォルトでは再実行せず、プリセットの`command`を実行する。`resume.enabled`の指定は関係しない。

プリセットのタブに`resume: true`を書くと、そのタブで前回動いていたコマンドを`command`の代わりに再実行する。再実行するコマンドが無いとき（前回はプロンプトに戻っていた、`allow`に無い、など）は`command`を実行する。

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

Boardごとの切り替えは、起動時レイアウトのBoardでも優先される。`再実行する`にしたBoardでは`resume`を書いていないタブも再実行し、`再実行しない`にしたBoardでは`resume: true`のタブも`command`を実行する。

## 記録されないコマンド

先頭に空白を付けて実行したコマンドは、記録しない。履歴に残したくないコマンドと同じ扱いになる。

bashでは、履歴に残らなかったコマンドは記録しない。`HISTCONTROL`に`ignoredups`を入れていると、直前と同じコマンドを続けて実行したときも記録されない。

再実行されないときは、そのタブの[シェル統合](/niwaterm/shell-integration/#更新と困ったとき)が新しいものになっているかを確かめる。今の設定は`niwa config show`の`resume`の欄で確かめられる。
