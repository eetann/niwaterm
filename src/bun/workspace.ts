// tile-layout.ts（純粋な木構造）と TerminalSession（I/O）を束ねる、状態を持つ層。
// bun/index.tsはこのモジュールだけを通してタイル・タブ・PTYを操作する。
import {
  closeTile,
  findNode,
  focusNeighbor,
  listLeaves,
  resizeSplit,
  splitTile,
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

  let nextId = 1;
  const genTileId = (): TileId => `tile-${nextId++}`;
  const genTabId = (): TabId => `tab-${nextId++}`;

  const firstTabId = genTabId();
  const firstTileId = genTileId();
  let tree: TileNode = {
    kind: "leaf",
    id: firstTileId,
    tabIds: [firstTabId],
    activeTabId: firstTabId,
  };
  let focusedTileId: TileId = firstTileId;

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
  spawnSession(firstTabId, opts.initialCols, opts.initialRows);

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

  // シェルが1つ終了した時の挙動。そのタブが属するタイルだけ閉じる。
  // ただし最後の1枚だった場合は今日と同じ「アプリごと終了」を維持する。
  function handleTabProcessExit(tabId: TabId): void {
    const leaf = listLeaves(tree).find((l) => l.tabIds.includes(tabId));
    if (!leaf) return;
    const result = closeTile(tree, leaf.id);
    if (result.tree === null) {
      disposeSessions(result.closedTabIds);
      opts.onAllTabsClosed();
      return;
    }
    applyCloseResult(result.tree, result.closedTabIds);
  }

  function splitTileById(tileId: TileId, orientation: SplitOrientation): void {
    const target = findNode(tree, tileId);
    if (!target || target.kind !== "leaf") return;
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
    if (!result) return;
    tree = result.tree;
    const size = sizeByTabId.get(target.activeTabId) ?? {
      cols: opts.initialCols,
      rows: opts.initialRows,
    };
    spawnSession(newTabId, size.cols, size.rows);
    focusedTileId = newTileId;
    opts.onDirty();
  }

  function closeTileById(tileId: TileId): void {
    const result = closeTile(tree, tileId);
    if (result.tree === null) return; // 最後の1枚は閉じない（誤操作防止）
    applyCloseResult(result.tree, result.closedTabIds);
  }

  function focusTileById(tileId: TileId): void {
    if (!findNode(tree, tileId)) return;
    focusedTileId = tileId;
    opts.onDirty();
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

  function dispose(): void {
    for (const session of sessions.values()) session.dispose();
    sessions.clear();
  }

  return {
    splitTile: splitTileById,
    closeTile: closeTileById,
    focusTile: focusTileById,
    focusDirection: focusDirectionFrom,
    resizeSplit: resizeSplitById,
    handleInput,
    handlePaste,
    handleResize,
    snapshot,
    dispose,
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
