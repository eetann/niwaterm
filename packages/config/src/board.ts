// Board設定。新しいタブを開くときのcwdの決め方、Board名の自動命名の方式、Boardに付けられる
// フェーズの候補をniwaterm.config.tsから変更できるようにする。
// browser.tsと同様、全フィールドoptionalの型を「ユーザーの部分上書き」に使う。
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

/**
 * 名前を付けていないBoardに自動で付く名前の決め方。
 * "directory": Boardを開いた時点のディレクトリ名で固定する。
 * "directory-follow": フォーカス中タブのcwdへ追従する（tmuxのautomatic-rename相当）。
 * "sequential": `Board 1`のような、ワークスペース内で重ならない連番。
 *
 * どの方式でも、ユーザー・CLIが明示的に付けた名前（`board rename`・`worktree open`の
 * ブランチ名）の方が優先される。
 */
export type BoardNaming = "directory" | "directory-follow" | "sequential";

const BOARD_NAMINGS: readonly BoardNaming[] = ["directory", "directory-follow", "sequential"];

export function isBoardNaming(value: unknown): value is BoardNaming {
  return typeof value === "string" && (BOARD_NAMINGS as readonly string[]).includes(value);
}

/** フェーズのidに許す文字。キーバインドの`set-board-phase:<id>`へそのまま埋め込むため空白を除く */
const PHASE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** サイドバーの右クリックメニュー・コマンドパレットに並べるフェーズの候補 */
export interface BoardPhasePreset {
  /** CLI（`niwaterm board phase set <id>`）・キーバインドから指す識別子 */
  id: string;
  /** サイドバーのバッジ・メニューに出す表示名。省略時はidをそのまま出す */
  label?: string;
  /** バッジの配色（CSSカラー）。省略時はUIの既定色 */
  color?: string;
}

/** labelの省略をidで埋めた解決済みのフェーズ候補 */
export interface ResolvedBoardPhase {
  id: string;
  label: string;
  /** 未指定はnull（表示側の既定色にフォールバックする） */
  color: string | null;
}

export interface BoardConfig {
  /**
   * タブ追加・タイル分割・ポップアップで新しいタブを開くときのcwd。
   * "worktree"を選んでも、Boardに紐づけが無い場合と紐づけ先が存在しない場合は"inherit"の挙動になる。
   */
  newTabCwd?: NewTabCwdMode;
  /**
   * 名前を付けていないBoardの自動命名。既定は"directory"（開いた時点のディレクトリ名で固定）。
   * "directory-follow"はcwdをOSC 7で報告するシェルでのみ追従できる。
   */
  naming?: BoardNaming;
  /**
   * Boardへ付けられるフェーズの候補。サイドバーの右クリックメニュー・コマンドパレットの
   * 選択肢になる。ここに無い文字列もCLIからは設定でき、その場合は文字列がそのまま既定色で出る。
   */
  phases?: BoardPhasePreset[];
}

export interface ResolvedBoardConfig {
  newTabCwd: NewTabCwdMode;
  naming: BoardNaming;
  phases: ResolvedBoardPhase[];
}

export const defaultBoardConfig: ResolvedBoardConfig = {
  newTabCwd: "inherit",
  naming: "directory",
  phases: [],
};

function isBoardPhasePreset(value: unknown): value is BoardPhasePreset {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v["id"] !== "string" || !PHASE_ID_PATTERN.test(v["id"])) return false;
  if (v["label"] !== undefined && (typeof v["label"] !== "string" || v["label"] === "")) {
    return false;
  }
  return v["color"] === undefined || (typeof v["color"] === "string" && v["color"] !== "");
}

/**
 * ユーザー設定のフェーズ候補を、表示側がそのまま使える形へ均す。
 * 不正な要素は黙って落とす（1件の書き間違いで候補が全滅すると、設定ファイルを直すまで
 * サイドバーから切り替えられなくなるため）。idの重複は先勝ちで、CLI・キーバインドの
 * `<id>`指定が一意に解決できる状態を保つ
 */
export function normalizeBoardPhases(value: unknown): ResolvedBoardPhase[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: ResolvedBoardPhase[] = [];
  for (const entry of value) {
    if (!isBoardPhasePreset(entry) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push({ id: entry.id, label: entry.label ?? entry.id, color: entry.color ?? null });
  }
  return result;
}

/**
 * Boardに設定された文字列の表示情報。候補に無い文字列（CLIから直接設定したもの）は
 * 文字列そのものをラベルとして既定色で出す
 */
export function resolveBoardPhase(
  phases: readonly ResolvedBoardPhase[],
  value: string,
): ResolvedBoardPhase {
  return phases.find((phase) => phase.id === value) ?? { id: value, label: value, color: null };
}
