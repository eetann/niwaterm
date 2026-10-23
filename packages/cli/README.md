# @niwaterm/cli

niwatermアプリをCLIから操作するコマンド（`niwa`）。AIコーディングエージェントが自律的にniwatermのワークスペース・タイル・タブ・ブラウザタブを操作できることを主眼に設計されている。

## セットアップ

```sh
cd packages/cli
bun link
```

`bin`フィールド経由で`niwa`コマンドと`fzf-niwa`コマンドがグローバル（`~/.bun/bin`）に登録される。`~/.bun/bin`がPATHに含まれていない場合は追加する。npm registryへの公開は現状スコープ外。

続けて`niwa init`を実行すると、設定ファイル（キーバインド・外観等）のディレクトリ`~/.config/niwaterm/`を生成できる。詳細は[website/src/content/docs/getting-started.md](../../website/src/content/docs/getting-started.md)参照。

## 使い方

```sh
niwa ping              # niwatermアプリとの疎通確認
niwa init              # 設定ディレクトリ(~/.config/niwaterm/)のセットアップ
niwa list              # ワークスペース・タイル・タブの一覧（--jsonでJSON）
niwa tab show --field board.id  # 実行中のタブが居るBoardのid（スクリプトで他のコマンドへ渡す用）
niwa worktree list     # gitのワークツリー一覧（アプリ未起動でも動く）
niwa worktree open dev # 既存ワークツリーをBoardとして開く
niwa docs list         # 利用可能なドキュメントトピックの一覧（--jsonでパース向けの出力）
niwa docs show cli     # 全コマンドの一覧と、説明のあるページ
niwa complete zsh      # シェルの補完スクリプトを出力（設置手順はdocs show shell-integrationの「シェル補完」）
```

オプションは`niwaterm <command> --help`で確かめられる。使い方の説明は`niwa docs show cli`（リポジトリ内なら[website/src/content/docs/cli.md](../../website/src/content/docs/cli.md)）の表から、各コマンドを説明したページへたどる。

AIエージェント向けの操作ガイドは[.agents/skills/niwaterm-cli/SKILL.md](../../.agents/skills/niwaterm-cli/SKILL.md)を参照。

## fzf-niwa

`fzf-tmux`互換のfzfラッパー（`bin/fzf-niwa`）。既存のfzf連携ツール（[zeno](https://github.com/yuki-yano/zeno.zsh)の各widget、`FZF_CTRL_T_COMMAND`等）が`fzf-tmux`を呼ぶのと同じ感覚で`fzf-niwa`を指定すると、fzfの対話UIをniwatermのpopup内に表示しつつ、選択結果だけを呼び出し元シェルへ直接返せる。ツール側の実装は無改造のまま使える。

```sh
ZENO_FZF_COMMAND=fzf-niwa zeno-history-selection
```

niwatermのタブ内（`NIWATERM_TAB_ID`が設定されている）でない場合や、popup起動に失敗した場合（アプリ未起動・既にpopup使用中等）は、ローカルの`fzf`にフォールバックする。呼び出し元シェルの`FZF_DEFAULT_OPTS`・`FZF_DEFAULT_OPTS_FILE`・`FZF_DEFAULT_COMMAND`・`BAT_THEME`はpopup内へ引き継がれるが、`FZF_DEFAULT_OPTS`由来の`--height`（通常のターミナル使用を想定した縮小表示）はpopup内では意味が無いため`--height=100%`で上書きし、popup全体を使い切る（fzf本家の`--tmux`が内部で行うのと同じ扱い）。
