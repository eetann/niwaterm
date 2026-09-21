// git worktree管理の設定。グローバル設定（niwaterm.config.ts）とプロジェクトローカル設定
// （<repoRoot>/.niwaterm/config.ts）の両方に書け、プロジェクトローカル側が優先される。
//
// ここに書かない場合はgit configの`niwaterm.worktree.dir`も見に行く（gtrと同じ流儀の補助口で、
// 優先順位はniwatermの設定より下）。詳細はdocs/guide/cli.mdのワークツリー管理の節。

export interface WorktreeConfig {
  /**
   * 新規ワークツリーの置き場所テンプレート。`${repo}`（メインワークツリーのディレクトリ名）と
   * `${branch}`（ブランチ名。`/`は`-`へ潰される）を展開する。
   * `~/`始まり・絶対パス・メインワークツリー基準の相対パスのいずれでも書ける。
   * 未指定時は`../${repo}@${branch}`（メインワークツリーの隣に`<repo>@<branch>`で並べる）。
   * 例: ".worktrees/${branch}"
   */
  dir?: string;
}
