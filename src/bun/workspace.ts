// tile-layout.ts（純粋な木構造）と TerminalSession（I/O）を束ねる、状態を持つ層。
// bun/index.tsはこのモジュールだけを通してタイル・タブ・PTYを操作する。
import type { BrowserRenderState, BrowserTabState } from "./browser-tab";
import {
  addTabToTile,
  closeTabInTile,
  findNode,
  focusNeighbor,
  listLeaves,
  resizeSplit,
  splitTile,
  switchActiveTab,
  toFlexDirection,
  type SplitOrientation,
  type TabId,
  type TileId,
  type TileNode,
} from "./tile-layout";
import {
  createTerminalSession,
  type TerminalRenderState,
  type TerminalSession,
} from "./terminal-session";

export type TabRenderState = TerminalRenderState | BrowserRenderState;

export interface WorkspaceRenderState {
  layout: TileNode;
  focusedTileId: TileId;
  tabs: Record<TabId, TabRenderState>;
}

export type GetTileVarResult =
  | { found: true; value: string }
  | { found: false; reason: "tile-not-found" | "not-set" };

export type WorkspaceOptions = {
  initialCols: number;
  initialRows: number;
  /** tile/tabのid採番。複数Workspaceインスタンス間でのid衝突を避けるため外部（workspace-manager.ts）から注入する */
  genTileId: () => TileId;
  genTabId: () => TabId;
  /** 永続化からの復元時に渡す既存の木構造（tileId/tabIdは採番済み）。省略時は単一leaf・単一タブで新規作成する */
  initialTree?: TileNode;
  /** 描画すべき変化が生じた時に呼ばれる。描画スケジューリングは呼び出し側の責務 */
  onDirty: () => void;
  /** 最後の1タブのプロセスが終了した時に呼ばれる。アプリを終了するかどうかの判断は呼び出し側の責務 */
  onAllTabsClosed: () => void;
  /**
   * 新規タブ作成時に使うデフォルトシェルを取得する。省略時はpty.ts側のOS標準シェルを使う。
   * 呼び出し毎に評価する（設定ファイルのホットリロードを反映するため、生成時に値を固定しない）
   */
  getDefaultShell?: () => string | undefined;
  /** テスト時にfakeへ差し替えるためのDI */
  createSession?: typeof createTerminalSession;
};

export function createWorkspace(opts: WorkspaceOptions) {
  const createSession = opts.createSession ?? createTerminalSession;
  const sessions = new Map<TabId, TerminalSession>();
  const browserTabs = new Map<TabId, BrowserTabState>();
  const sizeByTabId = new Map<TabId, { cols: number; rows: number }>();
  const tileVars = new Map<TileId, Map<string, string>>();

  const genTileId = opts.genTileId;
  const genTabId = opts.genTabId;

  function spawnSession(tabId: TabId, tileId: TileId, cols: number, rows: number): void {
    sizeByTabId.set(tabId, { cols, rows });
    const session = createSession({
      cols,
      rows,
      shell: opts.getDefaultShell?.(),
      // シェル統合スクリプトやタイル内のCLI呼び出しが`--tile`省略でこのタイルを指せるようにする
      env: { NIWATERM_TILE_ID: tileId },
      onOutput: () => opts.onDirty(),
      onExit: () => handleTabProcessExit(tabId),
    });
    sessions.set(tabId, session);
  }

  let tree: TileNode;
  let focusedTileId: TileId;
  if (opts.initialTree) {
    tree = opts.initialTree;
    const leaves = listLeaves(tree);
    focusedTileId = leaves[0].id;
    for (const leaf of leaves) {
      for (const tabId of leaf.tabIds) {
        spawnSession(tabId, leaf.id, opts.initialCols, opts.initialRows);
      }
    }
  } else {
    const firstTabId = genTabId();
    const firstTileId = genTileId();
    tree = { kind: "leaf", id: firstTileId, tabIds: [firstTabId], activeTabId: firstTabId };
    focusedTileId = firstTileId;
    spawnSession(firstTabId, firstTileId, opts.initialCols, opts.initialRows);
  }

  function disposeSessions(tabIds: TabId[]): void {
    for (const tabId of tabIds) {
      sessions.get(tabId)?.dispose();
      sessions.delete(tabId);
      sizeByTabId.delete(tabId);
      browserTabs.delete(tabId);
    }
  }

  function applyCloseResult(newTree: TileNode, closedTabIds: TabId[], closedTileId?: TileId): void {
    tree = newTree;
    disposeSessions(closedTabIds);
    if (closedTileId !== undefined) tileVars.delete(closedTileId);
    if (!findNode(tree, focusedTileId)) {
      focusedTileId = listLeaves(tree)[0]?.id ?? focusedTileId;
    }
    opts.onDirty();
  }

  // シェルが1つ終了した時の挙動。そのタブだけ閉じる（同じタイルに他のタブが残っていればタイルは維持）。
  // タイル内最後のタブで、かつワークスペース最後の1枚だった場合のみ「アプリごと終了」を維持する。
  function handleTabProcessExit(tabId: TabId): void {
    const leaf = listLeaves(tree).find((l) => l.tabIds.includes(tabId));
    if (!leaf) return;
    const result = closeTabInTile(tree, leaf.id, tabId);
    if (!result) return;
    if (result.tree === null) {
      disposeSessions([tabId]);
      opts.onAllTabsClosed();
      return;
    }
    applyCloseResult(result.tree, [tabId], result.tileClosed ? leaf.id : undefined);
  }

  function splitTileById(
    tileId: TileId,
    orientation: SplitOrientation,
  ): { tileId: TileId; tabId: TabId } | null {
    const target = findNode(tree, tileId);
    if (!target || target.kind !== "leaf") return null;
    const newSplitId = genTileId();
    const newTileId = genTileId();
    const newTabId = genTabId();
    const result = splitTile(
      tree,
      tileId,
      toFlexDirection(orientation),
      newSplitId,
      newTileId,
      newTabId,
    );
    if (!result) return null;
    tree = result.tree;
    const size = sizeByTabId.get(target.activeTabId) ?? {
      cols: opts.initialCols,
      rows: opts.initialRows,
    };
    spawnSession(newTabId, newTileId, size.cols, size.rows);
    focusedTileId = newTileId;
    opts.onDirty();
    return { tileId: newTileId, tabId: newTabId };
  }

  function newTab(tileId: TileId): TabId | null {
    const target = findNode(tree, tileId);
    if (!target || target.kind !== "leaf") return null;
    const newTabId = genTabId();
    const result = addTabToTile(tree, tileId, newTabId);
    if (!result) return null;
    tree = result;
    const size = sizeByTabId.get(target.activeTabId) ?? {
      cols: opts.initialCols,
      rows: opts.initialRows,
    };
    spawnSession(newTabId, tileId, size.cols, size.rows);
    opts.onDirty();
    return newTabId;
  }

  function newBrowserTab(tileId: TileId, url: string): TabId | null {
    const target = findNode(tree, tileId);
    if (!target || target.kind !== "leaf") return null;
    const newTabId = genTabId();
    const result = addTabToTile(tree, tileId, newTabId);
    if (!result) return null;
    tree = result;
    browserTabs.set(newTabId, { url });
    opts.onDirty();
    return newTabId;
  }

  function switchTab(tileId: TileId, tabId: TabId): boolean {
    const result = switchActiveTab(tree, tileId, tabId);
    if (!result) return false;
    tree = result;
    opts.onDirty();
    return true;
  }

  // タイルに複数タブがあればアクティブタブだけ閉じる。最後の1タブだった場合はタイルごと閉じる
  // （そのタイルがワークスペース最後の1枚だった場合のみ、誤操作防止のため何もしない）
  function closeTab(tileId: TileId, tabId: TabId): boolean {
    const result = closeTabInTile(tree, tileId, tabId);
    if (!result || result.tree === null) return false;
    applyCloseResult(result.tree, [result.closedTabId]);
    return true;
  }

  function focusTileById(tileId: TileId): boolean {
    if (!findNode(tree, tileId)) return false;
    focusedTileId = tileId;
    opts.onDirty();
    return true;
  }

  function focusDirectionFrom(direction: "up" | "down" | "left" | "right"): void {
    const next = focusNeighbor(tree, focusedTileId, direction);
    if (next) {
      focusedTileId = next;
      opts.onDirty();
    }
  }

  function resizeSplitById(splitId: TileId, ratio: number): void {
    tree = resizeSplit(tree, splitId, ratio);
    opts.onDirty();
  }

  function handleInput(tabId: TabId, data: string): void {
    sessions.get(tabId)?.write(data);
  }

  function handlePaste(tabId: TabId, data: string): void {
    sessions.get(tabId)?.paste(data);
  }

  function handleResize(
    tabId: TabId,
    cols: number,
    rows: number,
    cellWidthPx: number,
    cellHeightPx: number,
  ): void {
    const session = sessions.get(tabId);
    if (!session) return;
    if (session.resize(cols, rows, cellWidthPx, cellHeightPx)) {
      sizeByTabId.set(tabId, { cols, rows });
      opts.onDirty();
    }
  }

  function snapshot(): WorkspaceRenderState {
    const tabs: Record<TabId, TabRenderState> = {};
    for (const [tabId, session] of sessions) {
      tabs[tabId] = session.renderState();
    }
    for (const [tabId, state] of browserTabs) {
      tabs[tabId] = { kind: "browser", url: state.url };
    }
    return { layout: tree, focusedTileId, tabs };
  }

  /** workspace-managerがtileId/tabIdの所属先を判定するための軽量な参照。renderStateは計算しない */
  function getLayout(): TileNode {
    return tree;
  }

  function getFocusedTileId(): TileId {
    return focusedTileId;
  }

  function hasTab(tabId: TabId): boolean {
    return sessions.has(tabId);
  }

  function hasBrowserTab(tabId: TabId): boolean {
    return browserTabs.has(tabId);
  }

  /** 種別（terminal/browser）を問わずtabIdの所属tileIdを返す。不存在はnull */
  function findTileIdForTab(tabId: TabId): TileId | null {
    return listLeaves(tree).find((leaf) => leaf.tabIds.includes(tabId))?.id ?? null;
  }

  /** 対象タブの画面内容をプレーンテキストで取り出す。tabId不存在時はnull */
  function getTabText(tabId: TabId): string | null {
    return sessions.get(tabId)?.dumpText() ?? null;
  }

  /** leaf以外（split）・不存在のtileIdはfalse */
  function setTileVar(tileId: TileId, key: string, value: string): boolean {
    const target = findNode(tree, tileId);
    if (!target || target.kind !== "leaf") return false;
    let vars = tileVars.get(tileId);
    if (!vars) {
      vars = new Map();
      tileVars.set(tileId, vars);
    }
    vars.set(key, value);
    return true;
  }

  function getTileVar(tileId: TileId, key: string): GetTileVarResult {
    const target = findNode(tree, tileId);
    if (!target || target.kind !== "leaf") return { found: false, reason: "tile-not-found" };
    const value = tileVars.get(tileId)?.get(key);
    return value === undefined ? { found: false, reason: "not-set" } : { found: true, value };
  }

  /** tile不存在（またはleafでない）はnull。存在するが未設定は空オブジェクト */
  function listTileVars(tileId: TileId): Record<string, string> | null {
    const target = findNode(tree, tileId);
    if (!target || target.kind !== "leaf") return null;
    const vars = tileVars.get(tileId);
    return vars ? Object.fromEntries(vars) : {};
  }

  function dispose(): void {
    for (const session of sessions.values()) session.dispose();
    sessions.clear();
    browserTabs.clear();
    tileVars.clear();
  }

  return {
    splitTile: splitTileById,
    newTab,
    newBrowserTab,
    switchTab,
    closeTab,
    focusTile: focusTileById,
    focusDirection: focusDirectionFrom,
    resizeSplit: resizeSplitById,
    handleInput,
    handlePaste,
    handleResize,
    snapshot,
    getLayout,
    getFocusedTileId,
    hasTab,
    hasBrowserTab,
    findTileIdForTab,
    getTabText,
    setTileVar,
    getTileVar,
    listTileVars,
    dispose,
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
