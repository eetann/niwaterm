---
title: レイアウトプリセット
description: タイル構成をプリセットとして定義してCLIから適用する方法と、起動時レイアウトへの紐づけ
---

`layouts`は、あらかじめ定義したタイル構成をCLI（`niwaterm layout apply <name>`）から名前指定して適用できるようにするプリセット集（[vde-layout](https://github.com/yuki-yano/vde-layout)ライク）。**未指定なら機能オフ**で、`niwaterm layout list`にはビルトインのプリセット（`empty`。[「ビルトインのプリセット」節](/niwaterm/layouts/#ビルトインのプリセット)）だけが並ぶ。ビルトインと同名のプリセットをここで定義すると、そちらが優先されてビルトイン側は隠れる。

ここで定義するのは全プロジェクト共通のプリセット。リポジトリ固有のレイアウトは`<projectRoot>/.niwaterm/config.ts`にも置ける（同名ならそちらが優先される。書き方・解決順・trustの扱いは[プロジェクトローカルのレイアウト](/niwaterm/layouts/project-local/)）。プリセットの中身（下の表とタイル構成）はどちらでも同じ。

| フィールド    | 型                 | 意味                                             |
| ------------- | ------------------ | ------------------------------------------------ |
| `description` | `string`           | `niwaterm layout list`に表示する説明文（省略可） |
| `layout`      | `LayoutNodeConfig` | タイル構成（後述）                               |

```ts
layouts: {
  dev: {
    description: "Editor + server + logs",
    layout: {
      kind: "split",
      orientation: "horizontal",
      ratio: 0.7,
      first: { kind: "tile", tabs: [{ name: "editor", command: "nvim", focus: true }] },
      second: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ name: "server", command: "npm run dev", cwd: "~/proj" }] },
        second: { kind: "tile", tabs: [{ name: "logs", command: "tail -f logs/app.log" }] },
      },
    },
  },
},
```

`LayoutNodeConfig`は`kind`で2種類に分かれる。

- `{ kind: "split", orientation: "horizontal" | "vertical", ratio?: number, first: LayoutNodeConfig, second: LayoutNodeConfig }` — タイルを2分割する。既存のタイル分割（`niwaterm tile split`）と同じく`horizontal`は上下、`vertical`は左右に並べる。`ratio`は`first`が占める比率(0〜1、省略時0.5)。**N分割の配列指定は無く、3分割以上はネストで表現する**（上の例の`second`側を参照）
- `{ kind: "tile", tabs: LayoutTabConfig[], activeTab?: number }` — タイル1枚とその中のタブ一覧。`tabs`は最低1つ必要。`activeTab`はアクティブにするタブのindex（省略時は最後のタブ）

各タブ（`LayoutTabConfig`）のフィールドはすべて省略可。

| フィールド     | 型                       | 意味                                                                                                                                                         |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`         | `string`                 | タブ名（サイドバー・タブバー表示用）                                                                                                                         |
| `shellProfile` | `string`                 | 使用するシェルプロファイルのid（`niwaterm shell-profile list`で確認）。省略時はデフォルトシェル                                                              |
| `cwd`          | `string`                 | 作業ディレクトリ。省略時は`niwaterm layout apply`を実行したディレクトリ（`--cwd`で上書き可）                                                                 |
| `command`      | `string`                 | タブ作成後に流し込むコマンド（末尾にEnterを自動送信する）。改行を含む場合は1行ずつ実行される                                                                 |
| `delay`        | `number`                 | `command`を送信するまでの追加の待ち時間(ms)。省略時は0。シェルが入力を受け付けられるようになるまでの待ちはniwaterm側が自動で行う（下記）ため、通常は指定不要 |
| `vars`         | `Record<string, string>` | タブ変数（`tab var set`相当で注入）                                                                                                                          |
| `focus`        | `boolean`                | このタブに最終フォーカスを当てる。プリセット全体で1つまで指定できる                                                                                          |

`command`はPTY（シェル）が入力を受け付けられるようになってから送られる。分割で作ったタイルのタブはPTYの起動自体がwebview側の実測サイズ到達まで保留されるうえ、起動直後のシェルは初期化中に流し込まれた入力を取りこぼす（コマンドの先頭が欠けて途中から実行される）ため、niwatermは「PTYが最初の出力を返し、そこから出力が止まった＝プロンプトを出し終えた」時点まで送信を遅らせる。それでも足りない場合（プロンプト表示後も初期化が続くシェル等）は`delay`で追加の待ちを指定する。

`command`はキー入力としてではなく**ペーストとして**流し込まれる。1文字ずつのキー入力で送ると、zshのZLEのような行編集機能が文字ごとにシンタックスハイライト・補完の先読み・スニペット展開を走らせるため、コマンドが長いほど流し込みの完了が遅れる（プラグイン次第で1コマンドに数秒かかる）。ペーストなら行全体が1回の挿入として扱われるので待ち時間はほぼ無くなる代わりに、スニペット展開のような「入力中に働く」機能は`command`には効かない。bracketed paste（DEC 2004）を有効にしないシェルへは従来どおり1文字ずつの入力として送られる。

`command`はそのタブ自身にしか作用せず、vde-layoutの`{{pane_id:name}}`のような「同じプリセット内の別タブを参照するテンプレート構文」は無い（タブIDは適用のたびに再採番されるため、プリセット定義時点では固定できない）。同じプリセット内の別タブ（例: `role`変数で`claude`と印を付けたタブ）へ向けてコマンドを送りたい場合は、`command`の中で`niwaterm tab var find`（[CLIからの操作](/niwaterm/cli/)の`tab var`の説明を参照）を使い、実行時に対象タブのtabIdを検索する。`tab var find`は既定で「自分自身が属するBoard」の中だけを検索する。`layout apply`の適用先がBoard単位（ADR 0006）なので、同じプリセットを何度適用しても、同じrole名を持つ別Boardのタブと混線しない。

```ts
layout: {
  kind: "split",
  orientation: "vertical",
  first: {
    kind: "tile",
    tabs: [{ name: "claude", command: "claude", vars: { role: "claude" } }],
  },
  second: {
    kind: "tile",
    tabs: [
      {
        name: "editprompt",
        vars: { role: "editprompt" },
        command:
          'editprompt="editprompt open --editor nvim --always-copy"; ' +
          'target=$(niwaterm tab var find role claude | head -n1); ' +
          '[ -n "$target" ] && $editprompt --target-pane "$target" || $editprompt',
        focus: true,
      },
    ],
  },
},
```

`claude`タブの`vars`は作成直後（`command`送信より前）に反映されるため、ツリー内で先に定義した兄弟タイルのタブは、後から作成されるタブの`command`から`tab var find`で確実に見つけられる。

適用はCLIから行う。

```sh
niwaterm layout list
niwaterm layout apply dev
niwaterm layout apply dev --replace
niwaterm layout apply dev --startup
```

`niwaterm layout apply <name>`は既定で新規Boardとして適用する（適用先はBoard単位、ADR 0006）。`--replace`を指定すると既存Boardを単一タイルへ畳んでから適用し直す（**既存タブ・PTYは無条件でcloseされる**ため、実行前にy/n確認プロンプトが表示される。確認なしで実行したい場合は`--replace-force`を使う）。`shellProfile`が未知のid・`focus:true`が2つ以上、といった不正なプリセットはBoardに一切手を触れずエラーになる。詳細・エラー時の挙動は「一覧と適用」節を参照。

`--startup`を付けると、そのBoardは次回以降の**起動時にもこのプリセットで組み直される**。niwatermは通常、終了時のレイアウト骨格（タイル構成・タブ名・シェル・cwd・タブ変数）を保存して復元するが、`command`は再実行しない。起動時レイアウトにしたBoardは骨格の復元ではなくプリセットの再適用になるため、`command`ごと毎回同じ状態で立ち上がる。Boardごとに別のプリセットを紐づけられるので、「開発用Boardは`dev`、メモ用Boardは`notes`」のような使い分けができる。後から切り替える・解除するには`niwaterm board startup layout|restore|clear`を使う（[「起動時レイアウト」節](/niwaterm/layouts/#起動時レイアウト)）。起動時にタブが開くディレクトリは`--startup`を付けて実行したディレクトリが記録されて使われる（プロジェクトローカルのプリセットならその解決元）。

## 一覧と適用（`layout list` / `layout apply`）

```sh
niwaterm layout list [--cwd <dir>]
niwaterm layout apply <name> [--replace | --replace-force] [--board <boardId>] [--workspace <workspaceId>] [--cwd <dir>] [--startup] [--trust]
```

`niwaterm.config.ts`の`layouts`（詳細: [レイアウトプリセット](/niwaterm/layouts/)）とプロジェクトローカルの`.niwaterm/config.ts`（[プロジェクトローカルのレイアウト](/niwaterm/layouts/project-local/)）で定義したプリセットを一覧・適用する（[vde-layout](https://github.com/yuki-yano/vde-layout)ライク）。適用先はBoard単位（ADR 0006、`docs/adr/0006-adopt-board-layer-between-workspace-and-tile.md`）。

- `layout list` — 定義済みプリセットを`name<TAB>解決元<TAB>description`形式で表示する。解決元は`[project: <projectRoot>]`・`[global]`・`[builtin]`のいずれか。`--cwd`はプロジェクトローカルのプリセットを探す起点で、省略時は実行したディレクトリ。ユーザー定義が1件も無い場合はビルトインだけが並び、その旨を併せて表示する
- `layout apply <name>` — 指定したプリセットを適用する。デフォルトは新規Boardとして適用し（`--workspace`省略時は現在アクティブなワークスペース配下）、成功時にその`boardId`を表示する。`--replace`は既存Board（`--board`省略時は現在アクティブなBoard）を単一タイルへ畳んでから適用し直す（**既存タブ・PTYは無条件でcloseされる**）。`--replace`は実行前に対象を明示したy/n確認プロンプトを表示する（TTYでない場合は確認できないためエラーで終了する）。ただし対象Boardがタイル1つ・タブ1つだけのときは閉じて失われるものが無いため、確認プロンプトは出ない（非対話環境でも実行できる）。`--replace-force`は`--replace`と同じ効果で確認プロンプトを省略する。`--replace`/`--replace-force`と`--workspace`、いずれも未指定時の`--board`は同時指定不可。`--cwd`は各タブの`cwd`未指定時に使う作業ディレクトリで、省略時は`niwaterm layout apply`を実行したディレクトリになる（プロジェクトローカル由来のプリセットでは`--cwd`ではなくプロジェクトルートが基準になる。`--replace`/`--replace-force`時、最初に到達するタイルだけは既存タブを使い回すが、そのタブのPTYも基準cwdで起動し直されるためタイル間でcwdが食い違うことはない）。成功時は`board: <boardId><TAB>preset: <name>`を表示し、プロジェクトローカル由来なら`[project: <projectRoot>]`が付く

指定した`name`が未定義の場合、指定した`workspaceId`/`boardId`が存在しない場合、プリセットの検証に失敗した場合はいずれもエラーメッセージと共に終了コード1を返す（検証失敗の主な原因は`shellProfile`の未知のid、`focus:true`の重複、ratioの範囲外指定等）。検証失敗時はBoardに一切変更を加えない。

## ビルトインのプリセット

設定ファイルに何も書かなくても使えるプリセットがある。`layout list`では解決元が`[builtin]`と表示され、同名のプリセットを`niwaterm.config.ts`や`.niwaterm/config.ts`に定義するとそちらが優先されてビルトインは隠れる。

```sh
# 今のBoardを片付けて、タイル1つ・タブ1つの状態に戻す
niwaterm layout apply empty --replace
```

- `empty` — Boardをタイル1つ・タブ1つへ畳む。**残る1タブもシェルを起動し直す**ので、そのBoardで動いていたプロセスは1つ残らず止まる。引き継ぐのは残るタブの作業ディレクトリだけで、タブ名・タイル名・タブ変数は消える（他のプリセットと違い`--cwd`は見ない。片付けた結果として知らないディレクトリに立っている、という状態を避けるため）。残る1タブがブラウザタブだった場合はterminalタブへ置き換わる。`--replace`を付けなければ空のBoardを1つ作るだけなので、`board new`と同じ意味になる

## 起動時レイアウト

niwatermは終了時のレイアウト（タイル構成・タブの名前・シェル・cwd・タブ変数）を保存し、次回起動時に復元する。ただし復元されるのは骨格だけで、プリセットの`command`は再実行されない。「このBoardは毎回このレイアウトで立ち上げたい」場合は`--startup`を使う。

```sh
# このプリセットでBoardを作り、次回以降の起動時も同じ構成で立ち上げる
niwaterm layout apply dev --startup

# 既存Boardを後から起動時レイアウトへ切り替える／戻す
niwaterm board startup layout --board board-12 --preset dev
niwaterm board startup restore --board board-12
niwaterm board startup clear --board board-12
```

`layout apply`は成功したBoardに適用したプリセット名を必ず記録する。`--startup`を付けた場合だけそのBoardが起動時の組み直し対象（`restoreMode: "layout"`）になり、付けなければ名前を覚えるだけで従来どおり保存した骨格を復元する。

`worktree new`／`worktree open`の`--layout`だけは`--startup`を付けずとも紐づく。あちらはBoardの中身をプリセットが決めているため（[「レイアウトプリセットの適用」節](/niwaterm/worktrees/hooks/#レイアウトプリセットの適用)）。

`board startup <mode>`のmodeは次の3つ。`--preset`を省略すると、そのBoardに既に記録されているプリセット名を（プロジェクトローカル由来ならその解決元ごと）引き継ぐ（一度も`layout apply`していないBoardでは`--preset`が必須）。

- `layout` — 起動時にプリセットで組み直す。保存した骨格は使わないので、前回セッションのタブ名・タブ変数・cwdは持ち込まれず、プリセットの`command`も改めて実行される
- `restore` — 保存した骨格を復元する（既定の挙動）。プリセット名の記録自体は残るので、あとから`layout`へ戻せる
- `clear` — プリセットの紐づけごと解除する

起動時にタブが開くディレクトリは、紐づけを作った時点のもの（`layout apply`・`board startup --preset`を実行したディレクトリ、`--cwd`を渡したならその値。`worktree new`／`worktree open`で開いたBoardならそのワークツリー）になる。プロジェクトローカル由来のプリセットの場合だけは実行ディレクトリではなく解決元の`projectRoot`が基準になる（どこから実行しても同じ構成を再現するため）。いずれの場合も、プリセット側で`cwd`を指定したタブはそちらが優先される。別のディレクトリで開き直したくなったら、そのディレクトリで`layout apply <name> --replace --startup`（または`board startup layout --preset <name>`）を実行して紐づけ直す。`board startup`で`--preset`を省略したときはモードだけが変わり、記録済みのディレクトリはそのまま引き継がれる。

起動時にプリセットが設定から消えていた場合、そのBoardは単一タブのまま残り、デスクトップ通知でその旨を知らせる（骨格は復元されない）。プリセット名を変える際は`board startup`で追随させること。プロジェクトローカル由来の場合は、記録された`projectRoot`が消えている・`.niwaterm/config.ts`からプリセットが消えている場合も同じ扱いになる。

サイドバーのBoard行を右クリック → 「起動時レイアウト」からも設定できる。**プリセットを選ぶとその場でBoardへ適用し、同時に起動時レイアウトとしても紐づける**（`layout apply <name> --replace --startup --board <boardId>`と同じ）。次回の起動を待たずに結果が見えるので、意図と違うプリセットを選んだことにその場で気づける。既存タブ・PTYを閉じる破壊的操作なので確認ダイアログが出る（プロジェクトローカル由来なら、その中でtrustの確認文も併せて示される）。「紐づけを解除」は`board startup clear`にあたる（コマンドパレットの「Clear Board Startup Layout」・キーバインドの`clear-board-startup`アクションも同じ操作で、対象はアクティブなBoard）。

プリセット一覧はそのBoardのフォーカス中タブのcwdから解決するため、そのタブで`layout list`を叩いたときと同じ顔ぶれになる（プロジェクトローカルのプリセットには`project`が付く）。紐づけのあるBoard行にはアイコンが出て、起動時に組み直すBoard（`layout`）だけ色が付く。`restore`モードへの切り替え（紐づけを残したまま起動時の組み直しだけ止める）はサイドバーには無いので`board startup restore`を使う。
