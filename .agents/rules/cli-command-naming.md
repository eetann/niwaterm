# CLIコマンドの命名規則

`packages/cli`（`niwaterm`コマンド）にサブコマンドを追加・変更する際のルール。
対象読者はAIエージェント・人間問わず、このCLIにコマンドを生やす全員。
コマンドの正式なリファレンスは`docs/guide/cli.md`で、ここには**命名の判断基準だけ**を置く。

## 基本形: `niwaterm <resource> <verb>`

コマンドは操作対象のリソース単位でグループ化する（git/kubectl/dockerと同じ発想）。

```
niwaterm tab new --tile <tileId>
niwaterm board switch --board <boardId>
niwaterm tile split --tile <tileId>
```

新しいverbを追加するとき、まず「どのリソースに属するか」を考える。既存リソースの正本は
`packages/cli/src/commands/`のディレクトリ構成（1ディレクトリ＝1リソース）。追加前に必ず
中身を見て、既存リソースへ寄せられないか確認する。

単一のリソースIDを主語に取らない操作だけ、トップレベルの`niwaterm <command>`に置く
（`list`はワークスペース・タイル・タブ横断の俯瞰表示。他は`ping`・`init`・`notify`のみ）。
トップレベルにはもう1つ`complete`（シェル補完スクリプトの出力）が並ぶが、これは
`@gunshi/plugin-completion`が生やすコマンドなのでこの規則の適用外。
迷ったら「これは単一のリソースIDを主語に取る操作か？」で判断する。

## verb語彙はリソース間で揃える

複数リソースで意味が対応するverbは同じ単語を使う。リソースごとに`create`/`new`/`add`のような
同義語がバラけると、覚えるコストが増える。

| verb | 意味 | 例 |
| --- | --- | --- |
| `new` | 作る | `tab new` / `window new` / `workspace new` / `board new` / `worktree new` |
| `close` | 閉じる | `tab close` / `window close` / `workspace close` / `board close` / `popup close` |
| `switch` | 対象へ切り替える | `tab switch` / `workspace switch` / `board switch` / `sidebar switch` |
| `list` | 複数を並べる | `window list` / `worktree list` / `keybind list` / `tab var list` |
| `show` | 単一の対象の内容を出す | `config show` / `docs show` / `board phase show` / `board worktree show` |
| `set` / `clear` | 値を設定／解除する | `board phase set` / `board worktree clear` / `tab var set` |
| `move` | 並び順・所属を変える | `board move` / `workspace move` |

**複数なら`list`、単一なら`show`**。`tab var get`・`browser get-text`・`browser get-html`の`get`は
既成事実として残しているだけなので、新設するときは`list`/`show`から選ぶ。

語彙から外れてよいのは、外れる理由がある場合だけ。

- `worktree remove` — ディレクトリごと消すので`close`ではない。`worktree open`は既存を開くだけで、
  作成を伴う`worktree new`と対になる
- `popup open` — ポップアップはBoardごとに1つのシングルトンなので、実体を増やす`new`ではない
- `tab restart` / `tile split` / `tile zoom` / `popup promote` / `layout apply` — そのリソースにしか無い操作

## あえて揃えない例外を潰さない

`tab capture`と`browser get-text`はどちらも「タブの内容をテキストで取る」だが、動詞を揃えない。
`tab capture`はtmuxの`capture-pane`に対応させる意図で残しており、その名前を期待して打つ利用者がいる。
一貫性のためだけに改名しない。

## 同名で別レイヤーを指すリソース

`board worktree`（`set`/`clear`/`show`）はBoardに紐づくワークツリーの**メタ属性**を操作する。
トップレベルの`worktree`（`new`/`open`/`list`/`remove`）はgitワークツリーの**実体**を操作する。
verbを足すときは「ディスク上のワークツリーを触るか、Boardの属性を触るか」で置き場所を決める。

## ネストは3階層まで

gunshiの`subCommands`でネストする（実装は既存の`commands/tab/index.ts`を見る）。3階層にしてよいのは
`tab var get`のように、リソース内へさらに明確なサブリソースがある場合のみ。4階層以上は複雑に
なりすぎるので、コマンド設計のほうを見直す。

ファイルは`commands/<resource>/<verb>.ts`、リソースに属さないものは`commands/<name>.ts`。
`font-size/run.ts`・`board/startup/run.ts`のように複数verbの共通処理を置くファイルはサブコマンド
ではない（`index.ts`の`subCommands`に載っているものだけがコマンド）。

## エラーメッセージ

`failAndExit`へ渡す文字列は`"<resource> <verb>に失敗しました: ${result.error}"`の形式で、
フルコマンド名を空白区切りで含める。サブコマンド単体の名前だけだと何の操作が失敗したか分かりにくいため。

## 対象IDのオプションは省略可能にする

`--tile`/`--tab`/`--board`/`--workspace`のような「操作対象を指すID」は`required: true`にせず、
`resolve-target.ts`の`createTargetResolver`で省略時のフォールバックを付ける。第2引数はエラー文言用の
フルコマンド名で、`failAndExit`へ渡すものと揃える。省略時はそのコマンドを実行しているタブ
（niwaterm外から実行した場合はフォーカス中タイル・アクティブタブ）が対象になる。

例外として`required: true`のまま残すのは以下。

- 自分自身を指しても意味が無い切り替え系（`tab switch --tab`・`board switch --board`・`workspace switch --workspace`）
- 誤送信の危険がある`tab send-keys --tab`
- 対象がブラウザタブに限られる`browser *`の`--tab`（自タブはterminalタブなのでフォールバックが成立しない）
- `tab var`系の`--tab`（`NIWATERM_TAB_ID`のみを見る。シェル統合・エージェント統合のhookがniwaterm外で
  意図しないタブへ書き込むのを避けるため）

オプションの`description`にも省略時の対象を書き、`docs/guide/cli.md`のシグネチャは
`[--tile <tileId>]`のように角括弧付きへ揃える。

## 排他オプションでまとめてよい条件

`tile focus`の`--tile`/`--direction`のように、結果の型が同じでパラメータの片方が省略可能な形で
自然に共存できるなら、1つのサブコマンドへ排他オプションとしてまとめてよい
（`tile focus-by-id`/`tile focus-by-direction`のようには分けない）。

## ドキュメントとの同期

コマンドを追加・変更したら、以下も必ず更新する。

- `docs/guide/cli.md` — コマンドの正式なリファレンス
- `.agents/skills/niwaterm-cli/SKILL.md` — AIエージェント向けの概要（詳細は書き写さず`docs/guide/cli.md`への導線に留める）
- `contrib/shell-integration/*` — シェル統合スクリプト（`niwaterm tab var set branch`を呼ぶ）
- `contrib/agent-integration/**/*.json` — エージェントのhooks設定（`niwaterm tab var set agent_status`を呼ぶ）

`contrib/`配下は`>/dev/null 2>&1`で出力を捨てるため、コマンド名がずれても`Command not found`が握り潰され、
「サイドバーに何も表示されない」という症状だけが残る。改名時は必ず
`grep -rn "niwaterm <旧コマンド名>" contrib/ docs/`で呼び出し側を洗い出すこと。
さらに`contrib/agent-integration/`のhooksは利用者が`~/.claude/settings.json`へコピーして使うため、
**リポジトリを直しても導入済みのコピーは追従しない**。破壊的な改名をしたらリリースノート等で周知する。
