// tile-layout.ts（純粋な木構造）と TerminalSession（I/O）を束ねる、状態を持つ層。
// bun/index.tsはこのモジュールだけを通してタイル・タブ・PTYを操作する。
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

export interface WorkspaceRenderState {
  layout: TileNode;
  focusedTileId: TileId;
  tabs: Record<TabId, TerminalRenderState>;
}

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
  /** テスト時にfakeへ差し替えるためのDI */
  createSession?: typeof createTerminalSession;
};

export function createWorkspace(opts: WorkspaceOptions) {
  const createSession = opts.createSession ?? createTerminalSession;
  const sessions = new Map<TabId, TerminalSession>();
  const sizeByTabId = new Map<TabId, { cols: number; rows: number }>();

  const genTileId = opts.genTileId;
  const genTabId = opts.genTabId;

  function spawnSession(tabId: TabId, cols: number, rows: number): void {
    sizeByTabId.set(tabId, { cols, rows });
    const session = createSession({
      cols,
      rows,
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
        spawnSession(tabId, opts.initialCols, opts.initialRows);
      }
    }
  } else {
    const firstTabId = genTabId();
    const firstTileId = genTileId();
    tree = { kind: "leaf", id: firstTileId, tabIds: [firstTabId], activeTabId: firstTabId };
    focusedTileId = firstTileId;
    spawnSession(firstTabId, opts.initialCols, opts.initialRows);
  }

  function disposeSessions(tabIds: TabId[]): void {
    for (const tabId of tabIds) {
      sessions.get(tabId)?.dispose();
      sessions.delete(tabId);
      sizeByTabId.delete(tabId);
    }
  }

  function applyCloseResult(newTree: TileNode, closedTabIds: TabId[]): void {
    tree = newTree;
    disposeSessions(closedTabIds);
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
    applyCloseResult(result.tree, [tabId]);
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
    spawnSession(newTabId, size.cols, size.rows);
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
    spawnSession(newTabId, size.cols, size.rows);
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
    const tabs: Record<TabId, TerminalRenderState> = {};
    for (const [tabId, session] of sessions) {
      tabs[tabId] = session.renderState();
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

  /** 対象タブの画面内容をプレーンテキストで取り出す。tabId不存在時はnull */
  function getTabText(tabId: TabId): string | null {
    return sessions.get(tabId)?.dumpText() ?? null;
  }

  function dispose(): void {
    for (const session of sessions.values()) session.dispose();
    sessions.clear();
  }

  return {
    splitTile: splitTileById,
    newTab,
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
    getTabText,
    dispose,
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
