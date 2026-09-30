# @niwaterm/cli

niwatermアプリをCLIから操作するコマンド（`niwaterm`）。AIコーディングエージェントが自律的にniwatermのワークスペース・タイル・タブ・ブラウザタブを操作できることを主眼に設計されている。

## セットアップ

```sh
cd packages/cli
bun link
```

`bin`フィールド経由で`niwaterm`コマンドと`fzf-niwaterm`コマンドがグローバル（`~/.bun/bin`）に登録される。`~/.bun/bin`がPATHに含まれていない場合は追加する。npm registryへの公開は現状スコープ外。

続けて`niwaterm init`を実行すると、設定ファイル（キーバインド・外観等）のディレクトリ`~/.config/niwaterm/`を生成できる。詳細は[website/src/content/docs/config.md](../../website/src/content/docs/config.md)参照。

## 使い方

```sh
niwaterm ping              # niwatermアプリとの疎通確認
niwaterm init              # 設定ディレクトリ(~/.config/niwaterm/)のセットアップ
niwaterm list              # ワークスペース・タイル・タブの一覧
niwaterm worktree list     # gitのワークツリー一覧（アプリ未起動でも動く）
niwaterm worktree open dev # 既存ワークツリーをBoardとして開く
niwaterm docs list         # 利用可能なドキュメントトピックの一覧（--jsonでパース向けの出力）
niwaterm docs show cli     # 全コマンドの使い方・IPCサーバー仕様を表示
niwaterm complete zsh      # シェルの補完スクリプトを出力（設置手順はdocs show cliの「シェル補完」）
```

コマンド一覧は`niwaterm --help`、個別コマンドの詳細は`niwaterm <command> --help`。全コマンドの詳しい使い方・実行例・IPCサーバー仕様は`niwaterm docs show cli`（またはリポジトリ内の[website/src/content/docs/cli.md](../../website/src/content/docs/cli.md)）を参照。

AIエージェント向けの操作ガイドは[.agents/skills/niwaterm-cli/SKILL.md](../../.agents/skills/niwaterm-cli/SKILL.md)を参照。

## fzf-niwaterm

`fzf-tmux`互換のfzfラッパー（`bin/fzf-niwaterm`）。既存のfzf連携ツール（[zeno](https://github.com/yuki-yano/zeno.zsh)の各widget、`FZF_CTRL_T_COMMAND`等）が`fzf-tmux`を呼ぶのと同じ感覚で`fzf-niwaterm`を指定すると、fzfの対話UIをniwatermのpopup内に表示しつつ、選択結果だけを呼び出し元シェルへ直接返せる。ツール側の実装は無改造のまま使える。

```sh
ZENO_FZF_COMMAND=fzf-niwaterm zeno-history-selection
```

niwatermのタブ内（`NIWATERM_TAB_ID`が設定されている）でない場合や、popup起動に失敗した場合（アプリ未起動・既にpopup使用中等）は、ローカルの`fzf`にフォールバックする。呼び出し元シェルの`FZF_DEFAULT_OPTS`・`FZF_DEFAULT_OPTS_FILE`・`FZF_DEFAULT_COMMAND`・`BAT_THEME`はpopup内へ引き継がれるが、`FZF_DEFAULT_OPTS`由来の`--height`（通常のターミナル使用を想定した縮小表示）はpopup内では意味が無いため`--height=100%`で上書きし、popup全体を使い切る（fzf本家の`--tmux`が内部で行うのと同じ扱い）。
