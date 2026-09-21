// Board設定。新しいタブを開くときのcwdの決め方をniwaterm.config.tsから変更できるようにする。
// browser.tsと同様、全フィールドoptionalの型を「ユーザーの部分上書き」と「マージ後の解決済み値」の
// 両方に使い回す。
//
// workspace.defaultCwdとは別物。あちらは「新規ワークスペースの最初のタブ」だけに効く初期値で、
// こちらは既存Board内でタブが増えるたびに効く。

/**
 * 新しいタブのcwdの決め方。
 * "inherit": 今のタブのcwdを引き継ぐ。
 * "worktree": Boardに紐づくワークツリーのディレクトリを使う。
 */
export type NewTabCwdMode = "inherit" | "worktree";

const NEW_TAB_CWD_MODES: readonly NewTabCwdMode[] = ["inherit", "worktree"];

export function isNewTabCwdMode(value: unknown): value is NewTabCwdMode {
  return typeof value === "string" && (NEW_TAB_CWD_MODES as readonly string[]).includes(value);
}

export interface BoardConfig {
  /**
   * タブ追加・タイル分割・ポップアップで新しいタブを開くときのcwd。
   * "worktree"を選んでも、Boardに紐づけが無い場合と紐づけ先が存在しない場合は"inherit"の挙動になる。
   */
  newTabCwd?: NewTabCwdMode;
}

export type ResolvedBoardConfig = Required<BoardConfig>;

export const defaultBoardConfig: ResolvedBoardConfig = {
  newTabCwd: "inherit",
};
