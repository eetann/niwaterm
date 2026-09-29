// git worktree管理の設定。グローバル設定（niwaterm.config.ts）とプロジェクトローカル設定
// （<repoRoot>/.niwaterm/config.ts）の両方に書け、項目ごとにプロジェクトローカル側が優先される。
//
// ここに書かない項目はgit configの`niwaterm.worktree.*`も見に行く（gtrと同じ流儀の補助口で、
// 優先順位はniwatermの設定より下）。詳細はdocs/guide/worktree.md。

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

export interface WorktreeHookContext {
  /** メインワークツリーのパス */
  repoRoot: string;
  /** 作成したワークツリーのパス */
  worktreePath: string;
  branch: string;
}

/**
 * ワークツリーを作った直後に走るフック。`bun install`・`.env`のコピー・`direnv allow`あたりを想定。
 * niwaterm CLIのプロセスで、Boardを開く前にawaitされる（タブが立ち上がる時点で準備が済んでいる）。
 * 実行中のカレントディレクトリは作成したワークツリーになる。
 * 標準出力はコマンドを実行したターミナルへそのまま流れる。
 */
export type WorktreeHook = (ctx: WorktreeHookContext) => unknown;

export interface WorktreeOpenHookContext {
  /** メインワークツリーのパス */
  repoRoot: string;
  /** 開いたワークツリーのパス */
  worktreePath: string;
  /** detached HEADのワークツリーはnull */
  branch: string | null;
  /** 今回の`worktree new`でワークツリーを新規作成したか。`worktree open`・作成済みならfalse */
  created: boolean;
  workspaceId: string;
  boardId: string;
  /** Boardのタブ（レイアウトプリセット適用後）。タイルの並び順 */
  tabIds: string[];
}

/**
 * ワークツリーのBoardを新規に作った後に走るフック。Boardのフェーズやタブ変数の設定を想定。
 * niwaterm CLIのプロセスで、レイアウトプリセットの適用まで済んでからawaitされる。
 * 実行中のカレントディレクトリは開いたワークツリーになる。
 * 既に開いているBoardを使い回したとき・Boardを作らない`--open`（`none`・`current-tab`）では走らない。
 */
export type WorktreeOpenHook = (ctx: WorktreeOpenHookContext) => unknown;

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
  /**
   * ワークツリーのBoardを開くときに適用するレイアウトプリセット名（`layouts`のキー）。
   * `niwaterm worktree new`・`worktree open`の`--layout`の既定値で、Boardを新規に作ったときだけ
   * 適用される（既にそのワークツリーのBoardが開いていれば既存のタブは壊さない）。
   * プリセットはメインワークツリーの`.niwaterm/`から引き、タブはそのワークツリーで開く。
   * 例: "dev"
   */
  layout?: string;
  /**
   * `niwaterm worktree new`がワークツリーを作る前にリモートをfetchするかどうか。未指定時はtrue。
   * `--fetch`／`--no-fetch`で個別に上書きできる。falseにすると、pushされたばかりのブランチを
   * 開くときに手でfetchしてから叩くことになる代わりに、作成のたびのネットワーク待ちが無くなる。
   * 既存のワークツリーを開き直すだけのときと`--track local`のときは、trueでもfetchしない。
   * 例: false
   */
  fetch?: boolean;
  /**
   * ワークツリーを新規作成した直後に走るフック。既存のワークツリーを開き直した場合は走らない。
   * グローバル設定とプロジェクトローカル設定の両方に書いた場合は、グローバル→プロジェクトの順に
   * **両方**走る（dir・openのような上書きではない）。
   * 失敗するとワークツリーを残したままコマンドが終了コード1で止まり、Boardは開かない。
   * 例: async () => { await Bun.$`bun install`; }
   */
  onCreate?: WorktreeHook;
  /**
   * `niwaterm worktree new`・`worktree open`がワークツリーのBoardを新規に作った後に走るフック。
   * `ctx.boardId`・`ctx.tabIds`を使ってCLIでBoardを操作する用途向け（`onCreate`の時点では
   * Boardがまだ無い）。`onCreate`と同じくグローバル→プロジェクトの順に**両方**走る。
   * 失敗してもBoardは閉じず、コマンドが終了コード1で止まる。
   * 例: async (ctx) => { if (ctx.created) await Bun.$`niwaterm board phase set impl --board ${ctx.boardId}`; }
   */
  onOpen?: WorktreeOpenHook;
}
