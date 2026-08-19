// 複数のBoard（createBoardのインスタンス）を束ね、Boardの切り替え・作成・削除を管理する層（ADR 0006）。
// workspace-manager.tsが複数Workspaceを束ねるのと同じパターンを、Workspace内で複数Boardへ1段複製したもの。
// tile/tabのid採番は既存方針どおりworkspace-manager.tsに一元化されたままで、このファイルはBoardId採番のみ担う。
import type { RestoredTreeMeta } from "./persistence";
import { toPersistedTileNode, type PersistedTileNode } from "./persistence";
import {
  createBoard,
  type Board,
  type BoardId,
  type BoardOptions,
  type BoardRenderState,
  type GetTabVarResult,
  type OpenPopupOptions,
} from "./board";

export type { BoardId, BoardRenderState, OpenPopupOptions, TabRenderState } from "./board";
import {
  findNode,
  listLeaves,
  type SplitOrientation,
  type TabId,
  type TileId,
} from "./tile-layout";

export type { GetTabVarResult } from "./board";

export type CloseBoardResult = { ok: true } | { ok: false; reason: "not-found" | "last-board" };

export interface WorkspaceRenderState {
  activeBoardId: BoardId;
  /** 表示順 */
  boardIds: BoardId[];
  /** アクティブなBoardの描画データのみ */
  board: BoardRenderState;
  /** サイドバー描画用。全Boardのレイアウト骨格（PTY内容は含まない、listBoards()と同一データ） */
  boards: BoardListEntry[];
}

export interface BoardListEntry {
  boardId: BoardId;
  active: boolean;
  focusedTileId: TileId;
  layout: BoardRenderState["layout"];
  tabVars: Record<TabId, Record<string, string>>;
  tabNames: Record<TabId, string>;
  tileNames: Record<TileId, string>;
  /** ユーザーがサイドバーから設定したBoard名。未設定はnull（表示側で連番にフォールバック） */
  name: string | null;
  /**
   * このBoardのポップアップ（ADR 0005）。
   * TODO(ADR 0006): 本来はWorkspace単位（Boardをまたいでも共有）だが、現状はBoard単位の暫定実装
   */
  popup: { tabId: TabId; visible: boolean } | null;
}

export interface BoardLocation {
  boardId: BoardId;
  tileId: TileId;
}

export interface InitialBoard {
  tree: NonNullable<BoardOptions["initialTree"]>;
  name?: string;
  restoredMeta?: RestoredTreeMeta;
}

export interface WorkspaceOptions {
  initialCols: number;
  initialRows: number;
  genTileId: () => TileId;
  genTabId: () => TabId;
  genBoardId: () => BoardId;
  /** 永続化からの復元時に渡す既存のBoard群。省略時は単一Boardで新規作成する */
  initialBoards?: InitialBoard[];
  /** 復元時、どのBoardをアクティブにするか（initialBoardsのインデックス）。省略時は先頭 */
  activeBoardIndex?: number;
  /** 新規作成時（initialBoards省略時）の最初のBoard・最初のタブに使うcwd */
  initialCwd?: string;
  onDirty: () => void;
  /** 最後の1Boardの最後のタブが閉じられた時に呼ばれる（Workspace自体が空になった） */
  onAllTabsClosed: () => void;
  getDefaultShell?: BoardOptions["getDefaultShell"];
  getDefaultCwd?: BoardOptions["getDefaultCwd"];
  createSession?: BoardOptions["createSession"];
}

export function createWorkspace(opts: WorkspaceOptions) {
  const boards = new Map<BoardId, Board>();
  let order: BoardId[] = [];
  let activeBoardId: BoardId;
  // Board名。getPersistableBoards経由で永続化対象になる
  const boardNames = new Map<BoardId, string>();

  function createAndRegisterBoard(
    initialTree?: BoardOptions["initialTree"],
    initialCwd?: string,
    restoredMeta?: RestoredTreeMeta,
  ): BoardId {
    const id = opts.genBoardId();
    const board = createBoard({
      initialCols: opts.initialCols,
      initialRows: opts.initialRows,
      genTileId: opts.genTileId,
      genTabId: opts.genTabId,
      initialTree,
      initialCwd,
      restoredMeta,
      onDirty: () => opts.onDirty(),
      onAllTabsClosed: () => handleBoardEmptied(id),
      getDefaultShell: opts.getDefaultShell,
      getDefaultCwd: opts.getDefaultCwd,
      createSession: opts.createSession,
    });
    boards.set(id, board);
    order.push(id);
    return id;
  }

  // あるBoardの最後のタイル・最後のタブが閉じられた時の挙動。
  // そのBoard自体を削除し、他のBoardへ切り替える。最後の1つだった場合のみWorkspace自体を空とみなす。
  function handleBoardEmptied(id: BoardId): void {
    boards.get(id)?.dispose();
    boards.delete(id);
    boardNames.delete(id);
    order = order.filter((bid) => bid !== id);
    if (order.length === 0) {
      opts.onAllTabsClosed();
      return;
    }
    if (activeBoardId === id) {
      activeBoardId = order[order.length - 1];
    }
    opts.onDirty();
  }

  if (opts.initialBoards && opts.initialBoards.length > 0) {
    for (const initialBoard of opts.initialBoards) {
      const id = createAndRegisterBoard(initialBoard.tree, undefined, initialBoard.restoredMeta);
      // setBoardNameは経由しない（onDirtyを呼ぶため。初期構築フェーズはdirty通知しない既存方針）
      if (initialBoard.name !== undefined) boardNames.set(id, initialBoard.name);
    }
    const clampedIndex = Math.min(Math.max(0, opts.activeBoardIndex ?? 0), order.length - 1);
    activeBoardId = order[clampedIndex];
  } else {
    activeBoardId = createAndRegisterBoard(undefined, opts.initialCwd);
  }

  function findBoardOwnerByTileId(tileId: TileId): Board | undefined {
    for (const board of boards.values()) {
      if (findNode(board.getLayout(), tileId)) return board;
    }
    return undefined;
  }

  function findBoardOwnerByTabId(tabId: TabId): Board | undefined {
    for (const board of boards.values()) {
      if (board.hasTab(tabId)) return board;
    }
    return undefined;
  }

  /** 種別（terminal/browser）を問わずtabIdの所在を返す */
  function locateTab(tabId: TabId): BoardLocation | null {
    for (const [boardId, board] of boards) {
      const tileId = board.findTileIdForTab(tabId);
      if (tileId) return { boardId, tileId };
    }
    return null;
  }

  function locateBrowserTab(tabId: TabId): BoardLocation | null {
    for (const [boardId, board] of boards) {
      if (!board.hasBrowserTab(tabId)) continue;
      const tileId = board.findTileIdForTab(tabId);
      if (tileId) return { boardId, tileId };
    }
    return null;
  }

  /** workspace-managerがtileIdの所属先Workspaceを判定するための軽量な参照 */
  function hasTile(tileId: TileId): boolean {
    return findBoardOwnerByTileId(tileId) !== undefined;
  }

  function getActiveBoardId(): BoardId {
    return activeBoardId;
  }

  function newBoard(cwd?: string): BoardId {
    activeBoardId = createAndRegisterBoard(undefined, cwd);
    opts.onDirty();
    return activeBoardId;
  }

  function switchBoard(boardId: BoardId): boolean {
    if (!boards.has(boardId)) return false;
    if (activeBoardId !== boardId) {
      activeBoardId = boardId;
      opts.onDirty();
    }
    return true;
  }

  function closeBoard(boardId: BoardId): CloseBoardResult {
    if (!boards.has(boardId)) return { ok: false, reason: "not-found" };
    if (boards.size === 1) return { ok: false, reason: "last-board" }; // 最後の1つは閉じない（誤操作防止）
    boards.get(boardId)?.dispose();
    boards.delete(boardId);
    boardNames.delete(boardId);
    order = order.filter((id) => id !== boardId);
    if (activeBoardId === boardId) {
      activeBoardId = order[order.length - 1];
    }
    opts.onDirty();
    return { ok: true };
  }

  /** 空文字列（trim後）を渡すとデフォルトの連番ラベルへ戻す */
  function setBoardName(boardId: BoardId, name: string): boolean {
    if (!boards.has(boardId)) return false;
    if (name.trim() === "") {
      boardNames.delete(boardId);
    } else {
      boardNames.set(boardId, name);
    }
    opts.onDirty();
    return true;
  }

  function splitTile(
    tileId: TileId,
    orientation: SplitOrientation,
    ratio?: number,
    cwd?: string,
  ): { tileId: TileId; tabId: TabId } | null {
    return findBoardOwnerByTileId(tileId)?.splitTile(tileId, orientation, ratio, cwd) ?? null;
  }

  function newTab(tileId: TileId, shellOverride?: string, cwd?: string): TabId | null {
    return findBoardOwnerByTileId(tileId)?.newTab(tileId, shellOverride, cwd) ?? null;
  }

  function newBrowserTab(tileId: TileId, url: string): TabId | null {
    return findBoardOwnerByTileId(tileId)?.newBrowserTab(tileId, url) ?? null;
  }

  // ポップアップは現状Board単位の暫定実装のため「現在アクティブなBoard」へルーティングする
  // （TODO(ADR 0006): 本来はWorkspace単位。roadmap「Board階層」節参照）
  function openPopup(popupOpts?: OpenPopupOptions): TabId | null {
    return boards.get(activeBoardId)?.openPopup(popupOpts) ?? null;
  }

  function closePopup(): boolean {
    return boards.get(activeBoardId)?.closePopup() ?? false;
  }

  function togglePopupVisibility(): boolean | null {
    return boards.get(activeBoardId)?.togglePopupVisibility() ?? null;
  }

  function promotePopup(): { tileId: TileId; tabId: TabId } | null {
    return boards.get(activeBoardId)?.promotePopup() ?? null;
  }

  function setBrowserTabUrl(tabId: TabId, url: string): boolean {
    for (const board of boards.values()) {
      if (board.hasBrowserTab(tabId)) return board.setBrowserTabUrl(tabId, url);
    }
    return false;
  }

  function switchTab(tileId: TileId, tabId: TabId): boolean {
    return findBoardOwnerByTileId(tileId)?.switchTab(tileId, tabId) ?? false;
  }

  // ドラッグ&ドロップによるタブ移動。PTYセッションはBoardインスタンスのクロージャ内に閉じているため、
  // Boardをまたぐ移動はセッションの移管が必要になり非対応（無視してfalseを返す）
  function moveTab(fromTileId: TileId, tabId: TabId, toTileId: TileId): boolean {
    const owner = findBoardOwnerByTileId(fromTileId);
    if (!owner || owner !== findBoardOwnerByTileId(toTileId)) return false;
    return owner.moveTab(fromTileId, tabId, toTileId);
  }

  function closeTab(tileId: TileId, tabId: TabId): boolean {
    return findBoardOwnerByTileId(tileId)?.closeTab(tileId, tabId) ?? false;
  }

  function focusTile(tileId: TileId): boolean {
    return findBoardOwnerByTileId(tileId)?.focusTile(tileId) ?? false;
  }

  function toggleZoomTile(tileId: TileId): boolean | null {
    return findBoardOwnerByTileId(tileId)?.toggleZoomTile(tileId) ?? null;
  }

  // 「現在フォーカス」基準の操作のため例外的にtileIdを取らず、アクティブなBoardへルーティングする
  function focusDirection(direction: "up" | "down" | "left" | "right"): void {
    boards.get(activeBoardId)?.focusDirection(direction);
  }

  function getFocusedTileId(): TileId {
    return (boards.get(activeBoardId) as Board).getFocusedTileId();
  }

  function getActiveTabId(tileId: TileId): TabId | null {
    const board = findBoardOwnerByTileId(tileId);
    if (!board) return null;
    const leaf = findNode(board.getLayout(), tileId);
    if (!leaf || leaf.kind !== "leaf") return null;
    return leaf.activeTabId;
  }

  function resizeSplit(splitId: TileId, ratio: number): void {
    findBoardOwnerByTileId(splitId)?.resizeSplit(splitId, ratio);
  }

  function resizeTileInDirection(
    tileId: TileId,
    direction: "up" | "down" | "left" | "right",
    delta: number,
  ): boolean {
    return findBoardOwnerByTileId(tileId)?.resizeTileInDirection(tileId, direction, delta) ?? false;
  }

  function respawnTab(
    tabId: TabId,
    shellOverride?: string,
    cwd?: string,
    command?: string,
  ): boolean {
    return findBoardOwnerByTabId(tabId)?.respawnTab(tabId, shellOverride, cwd, command) ?? false;
  }

  function handleInput(tabId: TabId, data: string): void {
    findBoardOwnerByTabId(tabId)?.handleInput(tabId, data);
  }

  function handlePaste(tabId: TabId, data: string): void {
    findBoardOwnerByTabId(tabId)?.handlePaste(tabId, data);
  }

  function handleScroll(tabId: TabId, deltaLines: number): void {
    findBoardOwnerByTabId(tabId)?.handleScroll(tabId, deltaLines);
  }

  function handleScrollToTop(tabId: TabId): void {
    findBoardOwnerByTabId(tabId)?.handleScrollToTop(tabId);
  }

  function handleScrollToBottom(tabId: TabId): void {
    findBoardOwnerByTabId(tabId)?.handleScrollToBottom(tabId);
  }

  function handleResize(
    tabId: TabId,
    cols: number,
    rows: number,
    cellWidthPx: number,
    cellHeightPx: number,
  ): void {
    findBoardOwnerByTabId(tabId)?.handleResize(tabId, cols, rows, cellWidthPx, cellHeightPx);
  }

  function listBoards(): BoardListEntry[] {
    return order.map((id) => {
      const board = boards.get(id) as Board;
      const layout = board.getLayout();
      const tabVars: Record<TabId, Record<string, string>> = {};
      for (const leaf of listLeaves(layout)) {
        for (const tabId of leaf.tabIds) {
          tabVars[tabId] = board.listTabVars(tabId) ?? {};
        }
      }
      return {
        boardId: id,
        active: id === activeBoardId,
        focusedTileId: board.getFocusedTileId(),
        layout,
        tabVars,
        tabNames: board.listTabNames(),
        tileNames: board.listTileNames(),
        name: boardNames.get(id) ?? null,
        popup: board.getPopupInfo(),
      };
    });
  }

  function hasTab(tabId: TabId): boolean {
    return findBoardOwnerByTabId(tabId) !== undefined;
  }

  function getTabText(tabId: TabId): string | null {
    return findBoardOwnerByTabId(tabId)?.getTabText(tabId) ?? null;
  }

  function setTabVar(tabId: TabId, key: string, value: string): boolean {
    return findBoardOwnerByTabId(tabId)?.setTabVar(tabId, key, value) ?? false;
  }

  function getTabVar(tabId: TabId, key: string): GetTabVarResult {
    const owner = findBoardOwnerByTabId(tabId);
    if (!owner) return { found: false, reason: "tab-not-found" };
    return owner.getTabVar(tabId, key);
  }

  function listTabVars(tabId: TabId): Record<string, string> | null {
    return findBoardOwnerByTabId(tabId)?.listTabVars(tabId) ?? null;
  }

  // niwa.tab.var.find向け。Workspace内の全Board・タイル・タブを横断して探す
  function findTabsByVar(key: string, value: string): TabId[] {
    const result: TabId[] = [];
    for (const board of boards.values()) {
      for (const leaf of listLeaves(board.getLayout())) {
        for (const tabId of leaf.tabIds) {
          const found = board.getTabVar(tabId, key);
          if (found.found && found.value === value) result.push(tabId);
        }
      }
    }
    return result;
  }

  function setTabName(tabId: TabId, name: string): boolean {
    return findBoardOwnerByTabId(tabId)?.setTabName(tabId, name) ?? false;
  }

  function setTileName(tileId: TileId, name: string): boolean {
    return findBoardOwnerByTileId(tileId)?.setTileName(tileId, name) ?? false;
  }

  function snapshot(): WorkspaceRenderState {
    const active = boards.get(activeBoardId) as Board;
    return {
      activeBoardId,
      boardIds: [...order],
      board: active.snapshot(),
      boards: listBoards(),
    };
  }

  /** 永続化用。全Boardのlayout・タブメタ・名前をそのまま返す（PersistedBoard[]への変換はpersistence.ts側で行う） */
  function getPersistableBoards(): {
    boardId: BoardId;
    layout: PersistedTileNode;
    name?: string;
  }[] {
    return order.map((id) => {
      const board = boards.get(id) as Board;
      const layout = toPersistedTileNode(board.getLayout(), {
        focusedTileId: board.getFocusedTileId(),
        tabs: board.getPersistableTabs(),
        tileNames: board.listTileNames(),
      });
      const name = boardNames.get(id);
      return name !== undefined ? { boardId: id, layout, name } : { boardId: id, layout };
    });
  }

  function getActiveBoardIndex(): number {
    return order.indexOf(activeBoardId);
  }

  function dispose(): void {
    for (const board of boards.values()) board.dispose();
    boards.clear();
  }

  return {
    newBoard,
    switchBoard,
    closeBoard,
    setBoardName,
    splitTile,
    newTab,
    newBrowserTab,
    setBrowserTabUrl,
    openPopup,
    closePopup,
    togglePopupVisibility,
    promotePopup,
    switchTab,
    moveTab,
    closeTab,
    focusTile,
    focusDirection,
    toggleZoomTile,
    getFocusedTileId,
    getActiveTabId,
    resizeSplit,
    resizeTileInDirection,
    respawnTab,
    handleInput,
    handlePaste,
    handleResize,
    handleScroll,
    handleScrollToTop,
    handleScrollToBottom,
    snapshot,
    listBoards,
    hasTab,
    hasTile,
    locateTab,
    locateBrowserTab,
    getActiveBoardId,
    getActiveBoardIndex,
    getTabText,
    setTabVar,
    getTabVar,
    listTabVars,
    findTabsByVar,
    setTabName,
    setTileName,
    getPersistableBoards,
    dispose,
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
