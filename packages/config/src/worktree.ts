// git worktree管理の設定。グローバル設定（niwaterm.config.ts）とプロジェクトローカル設定
// （<repoRoot>/.niwaterm/config.ts）の両方に書け、項目ごとにプロジェクトローカル側が優先される。
//
// ここに書かない項目はgit configの`niwaterm.worktree.*`も見に行く（gtrと同じ流儀の補助口で、
// 優先順位はniwatermの設定より下）。詳細はdocs/guide/cli.mdのワークツリー管理の節。

/** `niwaterm worktree new`が作成後にワークツリーをniwatermのどこで開くか */
export type WorktreeOpenMode =
  /** 新規Boardとして開くが、そのBoardへは遷移しない（既定）。作業中のBoardを奪われない */
  | "board"
  /** 新規Boardとして開き、そのBoardへ遷移する */
  | "board-switch"
  /** 実行したタブをそのワークツリーへcdする（同じBoardの他のタブは触らない） */
  | "current-tab"
  /** 開かない。ワークツリーを作るだけ */
  | "none";

export interface WorktreeConfig {
  /**
   * 新規ワークツリーの置き場所テンプレート。`${repo}`（メインワークツリーのディレクトリ名）と
   * `${branch}`（ブランチ名。`/`は`-`へ潰される）を展開する。
   * `~/`始まり・絶対パス・メインワークツリー基準の相対パスのいずれでも書ける。
   * 未指定時は`../${repo}@${branch}`（メインワークツリーの隣に`<repo>@<branch>`で並べる）。
   * 例: ".worktrees/${branch}"
   */
  dir?: string;
  /**
   * `niwaterm worktree new`の`--open`の既定値。未指定時は`"board"`
   * （新規Boardとして開くが遷移しない）。
   * 例: "board-switch"
   */
  open?: WorktreeOpenMode;
}
