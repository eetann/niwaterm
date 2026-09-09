// ワークスペースの状態（レイアウト骨格・タブごとのcwd/シェル/名前/変数・ブラウザタブのURL）を永続化する。
// PTYのスクロールバック・実行中プロセスそのものは対象外。
// 復元時は各タブに対して新規シェルを起動する（terminalタブのみ）か、ブラウザタブとしてURLを開き直す。
// tabIds/tileIdの実体は保存せず新規採番するため、木構造の走査順（leafの並び・tabsの並び）で
// 永続化データと新規採番後のidを対応付ける。

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appSupportDir } from "./app-paths";
import type { FlexDirection, TabId, TileId, TileNode } from "./tile-layout";

export type PersistedTabKind = "terminal" | "browser";

interface PersistedTabBase {
  /** ユーザーがサイドバーから設定したタブ名。未設定は省略する */
  name?: string;
  /** setTabVar/listTabVarsの内容をそのまま保存する。OSC7報告のcwd("cwd"キー)も特別扱いせずこの中の1エントリとして含める */
  vars?: Record<string, string>;
}

export interface PersistedTerminalTab extends PersistedTabBase {
  kind: "terminal";
  /** 実際に使われた起動シェルコマンド文字列（例: "wsl.exe -d NixOS"）。省略時は復元時にgetDefaultShell()へフォールバック */
  shell?: string;
}

export interface PersistedBrowserTab extends PersistedTabBase {
  kind: "browser";
  url: string;
}

export type PersistedTab = PersistedTerminalTab | PersistedBrowserTab;

/**
 * 復元時に捨てるタブ変数のキー。contrib/agent-integration/のhooksが「今そのタブで動いている
 * エージェントプロセス」の状態を書き込むキーで、復元後のタブにそのプロセスは居ない。
 * 残すと実在しないエージェントの状態（応答待ち等）がサイドバーに出続ける
 */
export const EPHEMERAL_TAB_VAR_KEYS: ReadonlySet<string> = new Set([
  "agent",
  "agent_status",
  "agent_status_text",
  // ベルは「まだ見ていない出来事」の印。復元直後のタブは中身ごと出直しなので残す意味がない
  "bell",
]);

export interface PersistedTileLeaf {
  kind: "leaf";
  /** 表示順。最低1件 */
  tabs: PersistedTab[];
  activeTabIndex: number;
  /** ユーザーがサイドバーから設定したタイル名。未設定は省略する */
  name?: string;
  /** このleafがworkspace内でフォーカスされていたか。未フォーカスは省略する */
  focused?: boolean;
}

export interface PersistedTileSplit {
  kind: "split";
  direction: FlexDirection;
  ratio: number;
  first: PersistedTileNode;
  second: PersistedTileNode;
}

export type PersistedTileNode = PersistedTileLeaf | PersistedTileSplit;

/**
 * 起動時にBoardをどう組み直すか。
 * "restore": 保存したlayout（骨格）をそのまま復元する（従来の挙動、既定）。
 * "layout": presetのレイアウトプリセットをconfigから引いて再適用する（タブのcommandも再実行される）。
 */
export type BoardRestoreMode = "restore" | "layout";

/** Boardに紐づくレイアウトプリセットと、起動時の組み直し方 */
export interface PersistedBoardStartup {
  /** layoutsのキー（プリセット名） */
  preset: string;
  restoreMode: BoardRestoreMode;
  /**
   * プリセットの解決元プロジェクトルート（絶対パス）。
   * 省略時はグローバル設定（~/.config/niwaterm/niwaterm.config.ts）から引く。
   *
   * 起動時にはcwdが存在しないためプリセット名だけでは解決元が決まらない。Board内のタブのcwdから
   * 推測する方式は採らず（cdで変わるため解決キーとして不安定）、紐づけを作った時点の解決元を
   * ここへ記録して、起動時はそのディレクトリだけを読む。Boardが複数ディレクトリを開いていても
   * 「このBoardはどのプロジェクトのレイアウトで組まれたか」という出自は1つに定まる
   */
  projectRoot?: string;
  /**
   * 紐づけを作った時点の実行ディレクトリ（絶対パス）。tabConfig.cwdを指定していないタブの
   * cwdの基準になる。projectRootがある場合はそちらが基準になるため記録しない。
   *
   * 起動時にはCLIの実行ディレクトリが無く、記録しないとグローバル設定由来のプリセットで
   * 組み直されるBoardのタブが既定cwd（ホーム）で開いてしまう
   */
  cwd?: string;
}

/** 1つのBoard（Tileツリー1本）の永続化データ（ADR 0006） */
export interface PersistedBoard {
  layout: PersistedTileNode;
  /** ユーザーがサイドバーから設定したBoard名。未設定は省略する */
  name?: string;
  /**
   * `layout apply`で適用したレイアウトプリセット名と起動時の扱い。
   * プリセット由来でないBoardでは省略する。restoreMode: "layout"であってもプリセットが
   * configから消えているケースに備え、layout（骨格）は常に保存しておく
   */
  startup?: PersistedBoardStartup;
}

export interface PersistedWorkspace {
  /** 最低1件。Board階層導入前のデータはマイグレーションで単一Boardとして読み替える（migrateV2ToV3） */
  boards: PersistedBoard[];
  activeBoardIndex: number;
  /** ユーザーがサイドバーから設定したワークスペース名。未設定は省略する */
  name?: string;
}

export interface PersistedState {
  version: 3;
  workspaces: PersistedWorkspace[];
  activeWorkspaceIndex: number;
}

/** toPersistedTileNodeが必要とする、workspace.ts側の現在状態への参照 */
export interface PersistTreeContext {
  focusedTileId: TileId;
  /** workspace.getPersistableTabs()の戻り値をそのまま渡す */
  tabs: Record<TabId, PersistedTab>;
  /** workspace.listTileNames()の戻り値をそのまま渡す */
  tileNames: Record<TileId, string>;
}

export function toPersistedTileNode(tree: TileNode, ctx: PersistTreeContext): PersistedTileNode {
  if (tree.kind === "leaf") {
    const leaf: PersistedTileLeaf = {
      kind: "leaf",
      tabs: tree.tabIds.map((tabId): PersistedTab => ctx.tabs[tabId] ?? { kind: "terminal" }),
      activeTabIndex: Math.max(0, tree.tabIds.indexOf(tree.activeTabId)),
    };
    const name = ctx.tileNames[tree.id];
    if (name !== undefined) leaf.name = name;
    if (tree.id === ctx.focusedTileId) leaf.focused = true;
    return leaf;
  }
  return {
    kind: "split",
    direction: tree.direction,
    ratio: tree.ratio,
    first: toPersistedTileNode(tree.first, ctx),
    second: toPersistedTileNode(tree.second, ctx),
  };
}

export interface RestoredTreeMeta {
  /** 新規採番後のtabIdをキーとした、復元用タブメタ情報 */
  tabMeta: Map<TabId, PersistedTab>;
  /** 新規採番後のtileId（leafのみ）をキーとしたタイル名 */
  tileNames: Map<TileId, string>;
  /** focused: trueだったleafの新tileId。複数あった場合は最初に見つかったものを採用する。無ければnull */
  focusedTileId: TileId | null;
}

export interface RestoredTree extends RestoredTreeMeta {
  tree: TileNode;
}

/** tabIds/tileIdは新規採番（genTileId/genTabId）で再構築する。実体（PTY・ブラウザwebview）は復元しない */
export function buildTreeFromPersisted(
  node: PersistedTileNode,
  genTileId: () => TileId,
  genTabId: () => TabId,
): RestoredTree {
  const tabMeta = new Map<TabId, PersistedTab>();
  const tileNames = new Map<TileId, string>();
  let focusedTileId: TileId | null = null;

  function build(n: PersistedTileNode): TileNode {
    if (n.kind === "leaf") {
      const id = genTileId();
      const tabs = n.tabs.length > 0 ? n.tabs : [{ kind: "terminal" as const }];
      const tabIds = tabs.map((tab) => {
        const tabId = genTabId();
        tabMeta.set(tabId, tab);
        return tabId;
      });
      const activeIndex = Math.min(Math.max(0, n.activeTabIndex), tabIds.length - 1);
      if (n.name !== undefined) tileNames.set(id, n.name);
      if (n.focused && focusedTileId === null) focusedTileId = id;
      return { kind: "leaf", id, tabIds, activeTabId: tabIds[activeIndex] };
    }
    const id = genTileId();
    const first = build(n.first);
    const second = build(n.second);
    return { kind: "split", id, direction: n.direction, ratio: n.ratio, first, second };
  }

  const tree = build(node);
  return { tree, tabMeta, tileNames, focusedTileId };
}

export function persistedFilePath(): string {
  return join(appSupportDir(), "workspaces.json");
}

function isVarsRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === "string");
}

function isPersistedTab(value: unknown): value is PersistedTab {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["name"] !== undefined && typeof v["name"] !== "string") return false;
  if (v["vars"] !== undefined && !isVarsRecord(v["vars"])) return false;
  if (v["kind"] === "terminal") {
    return v["shell"] === undefined || typeof v["shell"] === "string";
  }
  if (v["kind"] === "browser") {
    return typeof v["url"] === "string";
  }
  return false;
}

function isPersistedTileNode(value: unknown): value is PersistedTileNode {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["kind"] === "leaf") {
    if (v["name"] !== undefined && typeof v["name"] !== "string") return false;
    if (v["focused"] !== undefined && typeof v["focused"] !== "boolean") return false;
    const tabs = v["tabs"];
    return (
      Array.isArray(tabs) && tabs.every(isPersistedTab) && typeof v["activeTabIndex"] === "number"
    );
  }
  if (v["kind"] === "split") {
    return (
      (v["direction"] === "row" || v["direction"] === "column") &&
      typeof v["ratio"] === "number" &&
      isPersistedTileNode(v["first"]) &&
      isPersistedTileNode(v["second"])
    );
  }
  return false;
}

function isPersistedBoardStartup(value: unknown): value is PersistedBoardStartup {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v["preset"] !== "string" || v["preset"] === "") return false;
  if (v["projectRoot"] !== undefined) {
    if (typeof v["projectRoot"] !== "string" || v["projectRoot"] === "") return false;
  }
  if (v["cwd"] !== undefined) {
    if (typeof v["cwd"] !== "string" || v["cwd"] === "") return false;
  }
  return v["restoreMode"] === "restore" || v["restoreMode"] === "layout";
}

function isPersistedBoard(value: unknown): value is PersistedBoard {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["name"] !== undefined && typeof v["name"] !== "string") return false;
  if (v["startup"] !== undefined && !isPersistedBoardStartup(v["startup"])) return false;
  return isPersistedTileNode(v["layout"]);
}

function isPersistedWorkspace(value: unknown): value is PersistedWorkspace {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["name"] !== undefined && typeof v["name"] !== "string") return false;
  if (typeof v["activeBoardIndex"] !== "number") return false;
  const boards = v["boards"];
  return Array.isArray(boards) && boards.length > 0 && boards.every(isPersistedBoard);
}

function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["version"] !== 3) return false;
  if (typeof v["activeWorkspaceIndex"] !== "number") return false;
  const workspaces = v["workspaces"];
  if (!Array.isArray(workspaces)) return false;
  return workspaces.every(isPersistedWorkspace);
}

// ---- version 2 → 3 マイグレーション（ADR 0006: Board階層の追加） ----
// v2はWorkspace直下に1本のlayoutを持つ構造だった。「Boardが1つだけのWorkspace」として読み替える。

interface PersistedWorkspaceV2 {
  layout: PersistedTileNode;
  name?: string;
}

function isPersistedWorkspaceV2(value: unknown): value is PersistedWorkspaceV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["name"] !== undefined && typeof v["name"] !== "string") return false;
  return isPersistedTileNode(v["layout"]);
}

function isPersistedStateV2(
  value: unknown,
): value is { version: 2; workspaces: PersistedWorkspaceV2[]; activeWorkspaceIndex: number } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["version"] !== 2) return false;
  if (typeof v["activeWorkspaceIndex"] !== "number") return false;
  const workspaces = v["workspaces"];
  if (!Array.isArray(workspaces)) return false;
  return workspaces.every(isPersistedWorkspaceV2);
}

function migrateV2ToV3(v2: {
  workspaces: PersistedWorkspaceV2[];
  activeWorkspaceIndex: number;
}): PersistedState {
  return {
    version: 3,
    workspaces: v2.workspaces.map((w) => {
      const board: PersistedBoard = { layout: w.layout };
      return w.name !== undefined
        ? { boards: [board], activeBoardIndex: 0, name: w.name }
        : { boards: [board], activeBoardIndex: 0 };
    }),
    activeWorkspaceIndex: v2.activeWorkspaceIndex,
  };
}

/** ファイルが無い・JSONとして壊れている・スキーマ不一致（v2/v3以外）のいずれでも例外を投げずnullを返す */
export async function loadPersistedState(path: string): Promise<PersistedState | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const data: unknown = await file.json();
    if (isPersistedState(data)) return data;
    if (isPersistedStateV2(data)) return migrateV2ToV3(data);
    return null;
  } catch {
    return null;
  }
}

export async function savePersistedState(path: string, state: PersistedState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(state, null, 2));
}
