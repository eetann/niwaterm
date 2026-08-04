# @niwaterm/cli

niwatermアプリをCLIから操作するコマンド（`niwaterm`）。AIコーディングエージェントが自律的にniwatermのワークスペース・タイル・タブ・ブラウザタブを操作できることを主眼に設計されている。

## セットアップ

```sh
cd packages/cli
bun link
```

`bin`フィールド経由で`niwaterm`コマンドがグローバル（`~/.bun/bin`）に登録される。`~/.bun/bin`がPATHに含まれていない場合は追加する。npm registryへの公開は現状スコープ外。

## 使い方

```sh
niwaterm ping           # niwatermアプリとの疎通確認
niwaterm list            # ワークスペース・タイル・タブの一覧
niwaterm docs list       # 利用可能なドキュメントトピックの一覧
niwaterm docs show cli   # 全コマンドの使い方・IPCサーバー仕様を表示
```

コマンド一覧は`niwaterm --help`、個別コマンドの詳細は`niwaterm <command> --help`。全コマンドの詳しい使い方・実行例・IPCサーバー仕様は`niwaterm docs show cli`（またはリポジトリ内の[docs/cli.md](../../docs/cli.md)）を参照。

AIエージェント向けの操作ガイドは[.claude/skills/niwaterm-cli/SKILL.md](../../.claude/skills/niwaterm-cli/SKILL.md)を参照。
