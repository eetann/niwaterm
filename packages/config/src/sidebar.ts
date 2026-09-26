// サイドバーの表示設定。ワークスペース一覧のBoard行に出すステータスライン（Board名の下の行）へ
// 何をどの順で並べるかを指定する。board.tsと違ってBoard自体の挙動には関与しない、見た目だけの設定。
//
// 値の出どころはBoard専用の変数ストアではなく代表タブのタブ変数（`niwaterm tab var set`）。
// ビルトインのbranch・agentも同じ値を読んでいる（sidebar-props.tsのbuildSidebarWorkspaceItems参照）。

/** ステータスラインに出せるビルトイン項目 */
export type SidebarBoardStatusBuiltin = "phase" | "branch" | "agent";

const SIDEBAR_BOARD_STATUS_BUILTINS: readonly SidebarBoardStatusBuiltin[] = [
  "phase",
  "branch",
  "agent",
];

/** タブ変数名に許す文字。CLI（`niwaterm tab var set`）が受け付ける範囲と揃える */
const TAB_VAR_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

const BUILTIN_PREFIX = "builtin:";
const TAB_VAR_PREFIX = "tab-var:";

/** 1項目の値の出どころ。`builtin:<id>`か`tab-var:<name>`をパースした結果 */
export type SidebarBoardStatusSource =
  | { kind: "builtin"; id: SidebarBoardStatusBuiltin }
  | { kind: "tab-var"; name: string };

/** 文字列だけで書いた場合はprefix・colorが既定のままになる短縮形 */
export type SidebarBoardStatusItem = string | SidebarBoardStatusItemConfig;

export interface SidebarBoardStatusItemConfig {
  /** `builtin:phase` / `builtin:branch` / `builtin:agent` / `tab-var:<name>` */
  source: string;
  /** 値の前に出す短いラベル。builtin:phaseでは使わない（バッジ表示のため） */
  prefix?: string;
  /** 値の文字色（CSSカラー）。builtin:phaseでは使わない（バッジの配色はboard.phasesで指定する） */
  color?: string;
}

/** sourceのパースとprefix・colorの省略を埋めた解決済みの1項目 */
export interface ResolvedSidebarBoardStatusItem {
  source: SidebarBoardStatusSource;
  /** 未指定はnull（ビルトインは表示側の既定ラベル、tab-varはラベル無し） */
  prefix: string | null;
  /** 未指定はnull（表示側の既定色） */
  color: string | null;
}

export interface SidebarConfig {
  /**
   * Board行のステータスラインへ並べる項目。並べた順に上から出る。
   * 空配列ならステータスライン自体が出ず、Board行は1行のままになる。
   */
  boardStatus?: SidebarBoardStatusItem[];
}

export interface ResolvedSidebarConfig {
  boardStatus: ResolvedSidebarBoardStatusItem[];
}

function builtinItem(id: SidebarBoardStatusBuiltin): ResolvedSidebarBoardStatusItem {
  return { source: { kind: "builtin", id }, prefix: null, color: null };
}

export const defaultSidebarConfig: ResolvedSidebarConfig = {
  boardStatus: [builtinItem("phase"), builtinItem("branch"), builtinItem("agent")],
};

/** `builtin:<id>`・`tab-var:<name>`を解釈する。未知の接頭辞・不正な名前はnull */
export function parseSidebarBoardStatusSource(value: string): SidebarBoardStatusSource | null {
  if (value.startsWith(BUILTIN_PREFIX)) {
    const id = value.slice(BUILTIN_PREFIX.length);
    return (SIDEBAR_BOARD_STATUS_BUILTINS as readonly string[]).includes(id)
      ? { kind: "builtin", id: id as SidebarBoardStatusBuiltin }
      : null;
  }
  if (value.startsWith(TAB_VAR_PREFIX)) {
    const name = value.slice(TAB_VAR_PREFIX.length);
    return TAB_VAR_NAME_PATTERN.test(name) ? { kind: "tab-var", name } : null;
  }
  return null;
}

/** 設定に書いたときの文字列へ戻す。重複判定と、表示側のReact keyに使う */
export function formatSidebarBoardStatusSource(source: SidebarBoardStatusSource): string {
  return source.kind === "builtin"
    ? `${BUILTIN_PREFIX}${source.id}`
    : `${TAB_VAR_PREFIX}${source.name}`;
}

function normalizeItem(entry: unknown): ResolvedSidebarBoardStatusItem | null {
  if (typeof entry === "string") {
    const source = parseSidebarBoardStatusSource(entry);
    return source === null ? null : { source, prefix: null, color: null };
  }
  if (typeof entry !== "object" || entry === null) return null;
  const v = entry as Record<string, unknown>;
  if (typeof v["source"] !== "string") return null;
  const source = parseSidebarBoardStatusSource(v["source"]);
  if (source === null) return null;
  const prefix = v["prefix"];
  if (prefix !== undefined && typeof prefix !== "string") return null;
  const color = v["color"];
  if (color !== undefined && (typeof color !== "string" || color === "")) return null;
  return { source, prefix: prefix ?? null, color: color ?? null };
}

/**
 * ユーザー設定のステータスライン項目を、表示側がそのまま使える形へ均す。
 * 不正な要素は黙って落とす（normalizeBoardPhasesと同じ理由。1件の書き間違いで
 * ステータスラインが全滅すると、設定ファイルを直すまで状態が何も見えなくなる）。
 * 配列でない値・未指定は既定の3項目へ戻す。空配列は「1つも出さない」という指定として尊重する。
 * 同じ出どころを2回並べても同じ行が増えるだけなので、重複は先勝ちで落とす
 */
export function normalizeSidebarBoardStatus(value: unknown): ResolvedSidebarBoardStatusItem[] {
  if (!Array.isArray(value)) return defaultSidebarConfig.boardStatus.map((item) => ({ ...item }));
  const seen = new Set<string>();
  const result: ResolvedSidebarBoardStatusItem[] = [];
  for (const entry of value) {
    const item = normalizeItem(entry);
    if (item === null) continue;
    const key = formatSidebarBoardStatusSource(item.source);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
