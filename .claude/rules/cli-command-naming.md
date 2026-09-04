# CLIコマンドの命名規則

`packages/cli`（`niwaterm`コマンド）にサブコマンドを追加・変更する際のルール。
対象読者はAIエージェント・人間問わず、このCLIにコマンドを生やす全員。

## 基本形: `niwaterm <resource> <verb>`

コマンドは操作対象のリソース単位でグループ化する（git/kubectl/dockerと同じ発想）。

```
niwaterm tab new --tile <tileId>
niwaterm tab close --tile <tileId> --tab <tabId>
niwaterm workspace new
niwaterm workspace switch --workspace <workspaceId>
niwaterm tile split --tile <tileId>
niwaterm popup open
```

新しいverbを追加する場合、まず「どのリソースに属するか」を考える。既存リソース: `tab` / `workspace` / `tile` / `popup` / `browser`。

## リソースに属さないコマンドはトップレベルに残す

`list`（ワークスペース・タイル・タブ横断の俯瞰表示）、`ping`、`layout`、`font-size`、`shell-profiles`、`docs`は単一リソースの操作ではないため、`<resource> <verb>`に押し込めずトップレベルの`niwaterm <command>`のままにする。迷ったら「これは単一のリソースIDを主語に取る操作か？」で判断する（取るなら`<resource> <verb>`、取らないならトップレベル）。

## verb語彙はリソース間でなるべく揃える

`new` / `close` / `switch` / `list`のような動詞は、複数リソースで意味が対応するなら同じ単語を使う（`tab new`と`workspace new`、`tab close`と`workspace close`等）。リソースごとに`create`/`new`/`add`のような同義語がバラけると、覚えるコストが増える。

## サブコマンドのネストはgunshiの`subCommands`で表現する

```ts
// commands/tab/close.ts
export default define({
  name: "close",
  description: "...",
  args: { ... },
  run: async (ctx) => { ... },
});

// commands/tab/index.ts
export default define({
  name: "tab",
  description: "...",
  subCommands: { new: newCommand, close: closeCommand, ... },
  run: () => {
    console.log('Run "niwaterm tab --help" for available subcommands.');
  },
});
```

3階層まではネスト可能（`tab var get`のように、リソースの中にさらに明確なサブリソースがある場合のみ）。4階層以上は複雑になりすぎるので避け、コマンド設計を見直す。

## ファイル配置

```
packages/cli/src/commands/
  <resource>/
    index.ts       # define({ name: resource, subCommands: {...} })
    <verb>.ts       # 各サブコマンドの実装
    <sub-resource>/ # 必要な場合のみ（例: tab/var/）
      index.ts
      <verb>.ts
```

リソースに属さないコマンドは`commands/<name>.ts`のフラット配置のまま（`list.ts`, `ping.ts`, `layout.ts`等）。

## エラーメッセージ

`failAndExit`へ渡す文字列は`"<resource> <verb>に失敗しました: ${result.error}"`の形式で、フルコマンド名を含める（`tab close`のように空白区切り）。サブコマンド単体の名前だけだと何の操作が失敗したか分かりにくいため。

## 排他オプションの扱い

`tile focus`の`--tile`/`--direction`のように、意味的には別コマンドになり得るが実装が単純な操作は、1つのサブコマンドに排他オプションとしてまとめてよい（無理に`tile focus-by-id`/`tile focus-by-direction`のように分けない）。判断基準: 結果の型が同じで、パラメータの片方が省略可能な形で自然に共存できるか。

## ドキュメントとの同期

コマンドを追加・変更したら、以下も必ず更新する。

- `docs/guide/cli.md` — コマンドの正式なリファレンス
- `.claude/skills/niwaterm-cli/SKILL.md` — AIエージェント向けの概要（詳細は書き写さず`docs/guide/cli.md`への導線に留める）
- `contrib/shell-integration/*` — シェル統合スクリプト（`niwaterm tab var set branch`を呼ぶ）
- `contrib/agent-integration/**/*.json` — エージェントのhooks設定（`niwaterm tab var set agent_status`を呼ぶ）

`contrib/`配下は`>/dev/null 2>&1`で出力を捨てるため、コマンド名がずれても`Command not found`が握り潰され、
「サイドバーに何も表示されない」という症状だけが残る。改名時は必ず
`grep -rn "niwaterm <旧コマンド名>" contrib/ docs/`で呼び出し側を洗い出すこと。
さらに`contrib/agent-integration/`のhooksは利用者が`~/.claude/settings.json`へコピーして使うため、
**リポジトリを直しても導入済みのコピーは追従しない**。破壊的な改名をしたらリリースノート等で周知する。
