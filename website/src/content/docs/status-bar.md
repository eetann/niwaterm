---
title: ステータスバー
description: ウィンドウ下端のステータスバー（statusBar）の部品の書き方と、CLIからの再描画・表示の切り替え
---

`statusBar`は、ウィンドウ下端に全幅で1本出すステータスバー（tmuxの`status-left`/`status-right`、Neovimのlualineに当たるもの）の設定。左・中央・右の3区画へ部品を並べる。表示の基準は**そのウィンドウでフォーカス中のタイルのアクティブタブ**で、タブ・Board・ワークスペースを切り替えると追従する。

未指定時は左にキー入力のモード、右にcwdが出る。サイドバーに出ている情報（Board名・ブランチ・エージェント状態）とは重ねていない。

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

- 書かなかった区画は既定の並びのまま（上の例では`center`が既定の空）。区画に空配列`[]`を書けばその区画は何も出さない
- `statusBar: false`でバーごと消える。全区画が空になった場合も出さない（空の帯が1行ぶん場所を取るだけになるため）
- バーはターミナルに重ねず、高さぶんをタイルの領域から差し引く（ブラウザタブのネイティブwebviewはHTMLより手前に描かれ、重ねるとバーが隠れるため）

## 部品の書き方

文字列で書いた部品は`source`だけを指定したのと同じ。

| `source`              | 出るもの                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"builtin:mode"`      | キー入力のモード。`NORMAL`・`PREFIX`（prefixキーを押して2打目を待っている間）・`COPY`（コピーモード中）のバッジ。配色は`appearance.ui`の`accent`・`warning`・`success` |
| `"builtin:cwd"`       | フォーカス中タブの作業ディレクトリ（OSC7シェル統合）。ホームは`~`へ縮め（WSLのタブはディストロ側のホーム）、マウスを載せると省略前のパスが出る                         |
| `"builtin:workspace"` | ワークスペース名（未設定なら`Workspace <n>`）                                                                                                                          |
| `"builtin:board"`     | Board名（未設定なら自動名・`Board <n>`）                                                                                                                               |
| `"tab-var:<name>"`    | フォーカス中タブのタブ変数の値（`niwaterm tab var set`で書き込む。ブランチなら`tab-var:branch`）                                                                       |

値が空の部品は幅を持たずに詰まる。

オブジェクトで書くと次のフィールドを指定できる。

| フィールド | 型                                                  | 意味                                                                                                                                                            |
| ---------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | `string`                                            | `niwaterm status-bar refresh --item`で指す名前。英数字・`_`・`-`で、部品間で重ねない。省略時は`left-0`のような「区画-区画内の番号」になる（並べ替えると変わる） |
| `source`   | `string`                                            | 上の表の値。`render`と同時には書けない（`render`が優先される）                                                                                                  |
| `render`   | `(ctx, niwa) => StatusBarSegment \| string \| null` | 中身を組み立てる関数。`async`も可。文字列を返せば`text`だけを指定したのと同じで、`null`・空文字列なら出ない                                                     |
| `interval` | `number`                                            | `render`を呼び直す周期(ms)。250ms未満は250msへ切り上げる。省略時は状況が変わった時だけ呼ぶ                                                                      |
| `prefix`   | `string`                                            | 値の前に出す短いラベル（値が空なら出ない）。区切りの空白が要るならここへ含める                                                                                  |
| `color`    | `string`                                            | 文字色（CSSカラー）                                                                                                                                             |
| `tooltip`  | `string`                                            | マウスを載せた時に出す説明                                                                                                                                      |
| `run`      | `(ctx, niwa) => void \| Promise<void>`              | 部品を押した時の処理。書いた部品だけが押せる見た目になる                                                                                                        |

`builtin:mode`には`prefix`・`color`が効かない（モードごとの配色は`appearance.ui`から取る）。

`render`の戻り値（`StatusBarSegment`）は`text`・`html`・`tooltip`・`color`を持てる。`html`は`text`より優先され、niwaterm本体のwebviewへそのまま入るため、外部から来た文字列（コマンド出力等）を埋め込むときは自分でエスケープする。`html`から参照するCSSは`statusBar.css`へ書く（本体のスタイルと衝突しないようclass名を工夫すること）。

## render・runへ渡る状況（`StatusBarContext`）

| フィールド                      | 意味                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `windowId`                      | バーを出しているウィンドウ                                |
| `workspaceId` / `workspaceName` | アクティブなワークスペースと表示名                        |
| `boardId` / `boardName`         | アクティブなBoardと表示名。Boardが無ければ`null`          |
| `tabId`                         | フォーカス中タイルのアクティブタブ。Boardが無ければ`null` |
| `cwd`                           | そのタブの作業ディレクトリ（未報告なら`undefined`）       |
| `vars`                          | そのタブのタブ変数                                        |
| `tabName`                       | サイドバーから付けたタブ名（未設定なら`undefined`）       |

`render`はこれらのどれかが変わった時にだけ呼ばれる（ターミナルの出力のたびには呼ばれない）。時計のように状況と無関係に変わる値は`interval`で周期的に呼び直す。`render`が例外を投げた部品は何も出さず、エラーはbun側のログへ出る。

## 再描画・表示の切り替え

`render`がniwatermの外の状態（gitの状態・ファイルの中身等）を読む場合、その変化は状況の変化として届かない。周期で読み直す`interval`の代わりに、変えた側から`niwaterm status-bar refresh`を呼んで知らせられる。`--item <id>`でその部品だけを評価し直す。idは部品の`id`フィールドで付けておくと、並べ替えても変わらない。付けていない部品のidと今の部品の一覧は`niwaterm config show`の`statusBar`で確認できる。

```ts
statusBar: {
  right: [
    {
      id: "todo",
      render: async (_ctx, niwa) => {
        const { stdout } = await niwa.shell.run("grep -c TODO ~/notes.md");
        return `TODO ${stdout.trim()}`;
      },
    },
  ],
},
```

```sh
# ノートを編集した後に
niwaterm status-bar refresh --item todo
```

バーを一時的に隠すには`toggle-status-bar`キーバインド（既定キーは無い）・コマンドパレットの「Toggle Status Bar」・`niwaterm status-bar toggle`を使う。隠した状態は全ウィンドウで共通で、次回起動時にも引き継ぐ。隠している間は`render`も`interval`も呼ばれず、出し直した時点の状況でまとめて評価し直す。`statusBar: false`で出さない設定にしている場合は切り替えられない。

## CLIから操作する（`status-bar`）

```sh
niwaterm status-bar refresh [--item <id>]
niwaterm status-bar toggle [--visible on|off]
```

ウィンドウ下端のステータスバー（設定の`statusBar`。詳細は[ステータスバー](/niwaterm/status-bar/)）を操作する。どちらも全ウィンドウが対象で、呼び出し元のウィンドウは問わない。

- `status-bar refresh` — 部品を状況が変わっていなくても評価し直す。`render`がniwatermの外の状態（gitの状態・ファイル等）を読む場合に、変えた側から変化を知らせるためのもの。`--item`でその部品だけに絞る。`<id>`は部品の`id`フィールド（付けていなければ`left-0`のような区画-番号）で、`niwaterm config show`の`statusBar`で確認できる。存在しないidはエラーメッセージ（今あるidの一覧付き）と共に終了コード1を返す。バーを隠している間は何も評価せず、出し直した時にまとめて評価する
- `status-bar toggle` — バーの表示/非表示を切り替える。`--visible on`/`off`で向きを指定でき、省略時は今の逆になる。隠した状態は次回起動時にも引き継ぐ（成功時 `status-bar: visible`/`status-bar: hidden` を表示）

`statusBar: false`で出さない設定にしている場合は、いずれもエラーメッセージと共に終了コード1を返す。キーバインド（`refresh-status-bar`・`toggle-status-bar`アクション。既定キーは無い）とコマンドパレットの「Refresh Status Bar」「Toggle Status Bar」からも実行できる。
