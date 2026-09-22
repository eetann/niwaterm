// ADR 0001の最上位階層であるWindow（OSウィンドウ）を束ねる層。OSウィンドウ1枚につき
// WorkspaceManagerを1つ持ち、idだけを受け取るCLI・RPCの操作を持ち主のウィンドウへ振り分ける。
// bun/index.tsとipc-server.tsはこのモジュールをWorkspaceManagerとして扱えるため、
// ウィンドウを意識しない操作（tab/tile/board/workspaceのid指定）は呼び出し側の変更なしで通る。
//
// ウィンドウは2種類ある（ADR 0007）。
// - メインウィンドウ(persistent: true): 起動時にworkspaces.jsonから復元し、終了時にも書き戻す。1つだけ
// - 一時ウィンドウ(persistent: false): まっさらな状態で開き、閉じても何も残さない（ブラウザの新規ウィンドウ相当）
//
// BrowserWindowの生成・破棄はElectrobun依存のためここでは行わず、onWindowOpened/onWindowClosedで
// bun/index.tsへ委ねる（このモジュールをElectrobun非依存に保ち、テストできるようにするため）。
import type { CopyModeKey } from "./copy-mode";
import type { MouseEventInput } from "./ghostty";
import type { PersistedBoardStartup, PersistedState } from "./persistence";
import type { SplitOrientation, SplitPlacement, TabId, TileId } from "./tile-layout";
import type { BoardId } from "./board";
import type { OpenPopupOptions } from "./workspace";
import {
  createWorkspaceManager,
  type AppRenderState,
  type WorkspaceManager,
  type WorkspaceManagerOptions,
  type WorkspaceId,
} from "./workspace-manager";

export type WindowId = string;

export interface WindowListEntry {
  windowId: WindowId;
  /** 前回の状態を復元し、終了時にも書き戻すウィンドウか。falseなら閉じた時点で何も残らない */
  persistent: boolean;
  /** 最後にフォーカスされたウィンドウか。id省略時の操作対象になる */
  focused: boolean;
  /** 表示順 */
  workspaceIds: WorkspaceId[];
  activeWorkspaceId: WorkspaceId;
}

/** ウィンドウそのものを操作する口。WorkspaceManagerの守備範囲外なので別インターフェースに切る */
export interface WindowOps {
  /** 一時ウィンドウを開く。ウィンドウを作れない構成（テスト用の既定実装）ではnull */
  newWindow(cwd?: string): WindowId | null;
  closeWindow(windowId: WindowId): boolean;
  listWindows(): WindowListEntry[];
  windowIdOfTab(tabId: TabId): WindowId | null;
  /**
   * そのウィンドウのWorkspaceManager。windowIdがnull・undefined・不明ならフォーカス中ウィンドウを返す。
   * 「今のウィンドウに対して」という意味を持つ操作（workspace new・popup open等）の起点として使う
   */
  managerOf(windowId: WindowId | null | undefined): WorkspaceManager;
}

type SharedWorkspaceOptions = Pick<
  WorkspaceManagerOptions,
  | "initialCols"
  | "initialRows"
  | "getDefaultShell"
  | "getDefaultCwd"
  | "getNewTabCwd"
  | "getMaxScrollback"
  | "isWorktreeMissing"
  | "onBell"
  | "createSession"
>;

export interface WindowManagerOptions extends SharedWorkspaceOptions {
  /** 起動時に読み込んだ永続化データ。メインウィンドウの初期状態になる */
  restoreFrom?: PersistedState | null;
  /** そのウィンドウに描画すべき変化が生じた時に呼ばれる。描画スケジューリングは呼び出し側の責務 */
  onDirty: (windowId: WindowId) => void;
  /** ウィンドウが増えた時。呼び出し側がBrowserWindowを作る */
  onWindowOpened: (windowId: WindowId) => void;
  /** ウィンドウが閉じられた時。呼び出し側がBrowserWindowを畳む（OSウィンドウ由来の場合は既に閉じている） */
  onWindowClosed: (windowId: WindowId) => void;
  /** 最後のウィンドウが閉じた時。アプリを終了するかどうかの判断は呼び出し側の責務 */
  onAllWindowsClosed: () => void;
  /** テスト時にfakeへ差し替えるためのDI */
  createManager?: typeof createWorkspaceManager;
}

interface WindowEntry {
  windowId: WindowId;
  workspaces: WorkspaceManager;
  persistent: boolean;
}

export function createWindowManager(opts: WindowManagerOptions) {
  const createManager = opts.createManager ?? createWorkspaceManager;
  const entries = new Map<WindowId, WindowEntry>();
  let order: WindowId[] = [];
  let focusedId: WindowId = "";

  // tile/tab/board/workspaceのidはウィンドウをまたいで一意でなければならない。CLI・RPCは
  // idだけで対象を指すため、ウィンドウごとに採番すると別ウィンドウの同番idを掴んでしまう
  let idSeq = 0;
  const nextIdSeq = (): number => idSeq++;
  let windowSeq = 0;

  function openWindow(persistent: boolean, restoreFrom?: PersistedState | null, cwd?: string) {
    const windowId: WindowId = `window-${windowSeq++}`;
    const workspaces = createManager({
      initialCols: opts.initialCols,
      initialRows: opts.initialRows,
      nextIdSeq,
      onDirty: () => opts.onDirty(windowId),
      // 最後のワークスペースが畳まれた＝そのウィンドウは空になったということ。
      // アプリごと終わらせるのは最後の1ウィンドウが閉じた時だけ（closeWindow内で判定する）
      onAllWorkspacesClosed: () => {
        closeWindow(windowId);
      },
      ...(restoreFrom !== undefined ? { restoreFrom } : {}),
      ...(cwd !== undefined ? { initialCwd: cwd } : {}),
      ...(opts.getDefaultShell !== undefined ? { getDefaultShell: opts.getDefaultShell } : {}),
      ...(opts.getDefaultCwd !== undefined ? { getDefaultCwd: opts.getDefaultCwd } : {}),
      ...(opts.getNewTabCwd !== undefined ? { getNewTabCwd: opts.getNewTabCwd } : {}),
      ...(opts.getMaxScrollback !== undefined ? { getMaxScrollback: opts.getMaxScrollback } : {}),
      ...(opts.isWorktreeMissing !== undefined
        ? { isWorktreeMissing: opts.isWorktreeMissing }
        : {}),
      ...(opts.onBell !== undefined ? { onBell: opts.onBell } : {}),
      ...(opts.createSession !== undefined ? { createSession: opts.createSession } : {}),
    });
    entries.set(windowId, { windowId, workspaces, persistent });
    order.push(windowId);
    focusedId = windowId;
    return windowId;
  }

  const mainWindowId = openWindow(true, opts.restoreFrom ?? null);

  /** 一時ウィンドウ（前回の状態を復元せず、閉じても何も残さない）を開く */
  function newWindow(cwd?: string): WindowId {
    const windowId = openWindow(false, null, cwd);
    opts.onWindowOpened(windowId);
    opts.onDirty(windowId);
    return windowId;
  }

  /**
   * ウィンドウを閉じる。OSウィンドウが閉じられた時と、最後のワークスペースが畳まれた時の
   * 両方から呼ばれるため冪等。PTYの後始末はここでWorkspaceManagerごと行う
   */
  function closeWindow(windowId: WindowId): boolean {
    const entry = entries.get(windowId);
    if (!entry) return false;
    entries.delete(windowId);
    order = order.filter((id) => id !== windowId);
    entry.workspaces.dispose();
    if (focusedId === windowId) focusedId = order[order.length - 1] ?? "";
    opts.onWindowClosed(windowId);
    if (order.length === 0) opts.onAllWindowsClosed();
    return true;
  }

  function listWindows(): WindowListEntry[] {
    return order.map((windowId) => {
      const entry = entries.get(windowId) as WindowEntry;
      const snap = entry.workspaces.snapshot();
      return {
        windowId,
        persistent: entry.persistent,
        focused: windowId === focusedId,
        workspaceIds: snap.workspaceIds,
        activeWorkspaceId: snap.activeWorkspaceId,
      };
    });
  }

  function hasWindow(windowId: WindowId): boolean {
    return entries.has(windowId);
  }

  function isPersistent(windowId: WindowId): boolean {
    return entries.get(windowId)?.persistent ?? false;
  }

  function getFocusedWindowId(): WindowId {
    return focusedId;
  }

  function setFocusedWindow(windowId: WindowId): void {
    if (entries.has(windowId)) focusedId = windowId;
  }

  // ---- ルーティング ----

  /**
   * フォーカス中ウィンドウのWorkspaceManager。ウィンドウが1枚も無い状態では呼ばれない
   * （最後の1枚が閉じた直後にonAllWindowsClosedでアプリが終わる）
   */
  function focused(): WorkspaceManager {
    const entry = entries.get(focusedId) ?? entries.values().next().value;
    if (!entry) throw new Error("internal error: no window is open");
    return entry.workspaces;
  }

  function managerOf(windowId: WindowId | null | undefined): WorkspaceManager {
    if (windowId === null || windowId === undefined) return focused();
    return entries.get(windowId)?.workspaces ?? focused();
  }

  function byTab(tabId: TabId): WorkspaceManager | undefined {
    for (const entry of entries.values()) {
      if (entry.workspaces.hasTab(tabId)) return entry.workspaces;
    }
    return undefined;
  }

  function byTile(tileId: TileId): WorkspaceManager | undefined {
    for (const entry of entries.values()) {
      if (entry.workspaces.hasTile(tileId)) return entry.workspaces;
    }
    return undefined;
  }

  function byBoard(boardId: BoardId): WorkspaceManager | undefined {
    for (const entry of entries.values()) {
      if (entry.workspaces.hasBoard(boardId)) return entry.workspaces;
    }
    return undefined;
  }

  function byWorkspace(workspaceId: WorkspaceId): WorkspaceManager | undefined {
    for (const entry of entries.values()) {
      if (entry.workspaces.hasWorkspace(workspaceId)) return entry.workspaces;
    }
    return undefined;
  }

  function windowIdOf(predicate: (workspaces: WorkspaceManager) => boolean): WindowId | null {
    for (const entry of entries.values()) {
      if (predicate(entry.workspaces)) return entry.windowId;
    }
    return null;
  }

  function windowIdOfTab(tabId: TabId): WindowId | null {
    return windowIdOf((m) => m.hasTab(tabId));
  }

  function windowIdOfWorkspace(workspaceId: WorkspaceId): WindowId | null {
    return windowIdOf((m) => m.hasWorkspace(workspaceId));
  }

  // ---- ウィンドウ単位の描画・永続化 ----

  function snapshotOf(windowId: WindowId): AppRenderState | null {
    return entries.get(windowId)?.workspaces.snapshot() ?? null;
  }

  /**
   * workspaces.jsonへ書き出す内容。メインウィンドウが閉じた後はnullを返し、
   * 呼び出し側は書き込みを見送る（一時ウィンドウの中身で上書きしないため）
   */
  function persistentState(): PersistedState | null {
    for (const entry of entries.values()) {
      if (entry.persistent) return entry.workspaces.serializeForPersistence();
    }
    return null;
  }

  /** 全ウィンドウの全タブのスクロールバック保持行数を差し替える（設定ファイルのホットリロード用） */
  function applyMaxScrollback(lines: number): void {
    for (const entry of entries.values()) entry.workspaces.applyMaxScrollback(lines);
  }

  function dispose(): void {
    for (const entry of entries.values()) entry.workspaces.dispose();
    entries.clear();
    order = [];
  }

  return {
    // ---- Window層 ----
    mainWindowId,
    newWindow,
    closeWindow,
    listWindows,
    hasWindow,
    isPersistent,
    getFocusedWindowId,
    setFocusedWindow,
    windowIdOfTab,
    windowIdOfWorkspace,
    managerOf,
    snapshotOf,
    persistentState,

    // ---- WorkspaceManager互換（idから持ち主のウィンドウを引いて委譲する） ----
    newWorkspace: (cwd?: string, windowId?: WindowId) => managerOf(windowId).newWorkspace(cwd),
    switchWorkspace: (workspaceId: WorkspaceId) =>
      byWorkspace(workspaceId)?.switchWorkspace(workspaceId) ?? false,
    closeWorkspace: (workspaceId: WorkspaceId) =>
      byWorkspace(workspaceId)?.closeWorkspace(workspaceId) ??
      ({ ok: false, reason: "not-found" } as const),
    newBoard: (
      workspaceId: WorkspaceId,
      cwd?: string,
      options?: Parameters<WorkspaceManager["newBoard"]>[2],
    ) => byWorkspace(workspaceId)?.newBoard(workspaceId, cwd, options) ?? null,
    hasBoard: (boardId: BoardId) => byBoard(boardId) !== undefined,
    switchBoard: (boardId: BoardId) => byBoard(boardId)?.switchBoard(boardId) ?? false,
    closeBoard: (boardId: BoardId) =>
      byBoard(boardId)?.closeBoard(boardId) ?? ({ ok: false, reason: "not-found" } as const),
    moveBoard: (boardId: BoardId, toIndex: number) =>
      byBoard(boardId)?.moveBoard(boardId, toIndex) ?? false,
    moveBoardBy: (boardId: BoardId, delta: number) =>
      byBoard(boardId)?.moveBoardBy(boardId, delta) ?? false,
    // ウィンドウをまたぐBoardの移動は未対応（PTY・webviewの載せ替えが必要）。
    // 別ウィンドウのワークスペースを指された場合はworkspace-not-foundとして弾く
    moveBoardToWorkspace: (boardId: BoardId, toWorkspaceId: WorkspaceId, toIndex?: number) => {
      const owner = byBoard(boardId);
      if (!owner) return { ok: false, reason: "board-not-found" } as const;
      if (!owner.hasWorkspace(toWorkspaceId)) {
        return { ok: false, reason: "workspace-not-found" } as const;
      }
      return owner.moveBoardToWorkspace(boardId, toWorkspaceId, toIndex);
    },
    setBoardName: (boardId: BoardId, name: string) =>
      byBoard(boardId)?.setBoardName(boardId, name) ?? false,
    setBoardStartup: (boardId: BoardId, startup: PersistedBoardStartup | null) =>
      byBoard(boardId)?.setBoardStartup(boardId, startup) ?? false,
    getBoardStartup: (boardId: BoardId) => byBoard(boardId)?.getBoardStartup(boardId) ?? null,
    setBoardWorktreePath: (boardId: BoardId, worktreePath: string | null) =>
      byBoard(boardId)?.setBoardWorktreePath(boardId, worktreePath) ?? false,
    getBoardWorktreePath: (boardId: BoardId) =>
      byBoard(boardId)?.getBoardWorktreePath(boardId) ?? null,
    getBoardFocusedCwd: (boardId: BoardId) => byBoard(boardId)?.getBoardFocusedCwd(boardId),
    getBoardFocusedShell: (boardId: BoardId) => byBoard(boardId)?.getBoardFocusedShell(boardId),
    findBoard: (boardId: BoardId) => byBoard(boardId)?.findBoard(boardId),
    listStartupLayoutBoards: () =>
      [...entries.values()].flatMap((entry) => entry.workspaces.listStartupLayoutBoards()),
    splitTile: (tileId: TileId, orientation: SplitOrientation, ratio?: number, cwd?: string) =>
      byTile(tileId)?.splitTile(tileId, orientation, ratio, cwd) ?? null,
    newTab: (tileId: TileId, shellOverride?: string, cwd?: string) =>
      byTile(tileId)?.newTab(tileId, shellOverride, cwd) ?? null,
    newBrowserTab: (tileId: TileId, url: string) =>
      byTile(tileId)?.newBrowserTab(tileId, url) ?? null,
    setBrowserTabUrl: (tabId: TabId, url: string) =>
      byTab(tabId)?.setBrowserTabUrl(tabId, url) ?? false,
    openPopup: (popupOpts?: OpenPopupOptions, windowId?: WindowId) =>
      managerOf(windowId).openPopup(popupOpts),
    closePopup: (windowId?: WindowId) => managerOf(windowId).closePopup(),
    waitForPopupClose: (windowId?: WindowId) => managerOf(windowId).waitForPopupClose(),
    togglePopupVisibility: (windowId?: WindowId) => managerOf(windowId).togglePopupVisibility(),
    promotePopup: (windowId?: WindowId) => managerOf(windowId).promotePopup(),
    switchTab: (tileId: TileId, tabId: TabId) => byTile(tileId)?.switchTab(tileId, tabId) ?? false,
    cycleTab: (tileId: TileId, delta: 1 | -1) => byTile(tileId)?.cycleTab(tileId, delta) ?? false,
    moveTab: (fromTileId: TileId, tabId: TabId, toTileId: TileId) =>
      byTile(fromTileId)?.moveTab(fromTileId, tabId, toTileId) ?? false,
    moveTabToSplit: (
      fromTileId: TileId,
      tabId: TabId,
      targetTileId: TileId,
      orientation: SplitOrientation,
      placement: SplitPlacement,
    ) =>
      byTile(fromTileId)?.moveTabToSplit(fromTileId, tabId, targetTileId, orientation, placement) ??
      false,
    closeTab: (tileId: TileId, tabId: TabId) => byTile(tileId)?.closeTab(tileId, tabId) ?? false,
    focusTile: (tileId: TileId) => byTile(tileId)?.focusTile(tileId) ?? false,
    focusDirection: (direction: "up" | "down" | "left" | "right", windowId?: WindowId) =>
      managerOf(windowId).focusDirection(direction),
    toggleZoomTile: (tileId: TileId) => byTile(tileId)?.toggleZoomTile(tileId) ?? null,
    getFocusedTileId: (windowId?: WindowId) => managerOf(windowId).getFocusedTileId(),
    getActiveTabId: (tileId: TileId) => byTile(tileId)?.getActiveTabId(tileId) ?? null,
    resizeSplit: (splitId: TileId, ratio: number) => byTile(splitId)?.resizeSplit(splitId, ratio),
    resizeTileInDirection: (
      tileId: TileId,
      direction: "up" | "down" | "left" | "right",
      delta: number,
    ) => byTile(tileId)?.resizeTileInDirection(tileId, direction, delta) ?? false,
    respawnTab: (tabId: TabId, shellOverride?: string, cwd?: string, command?: string) =>
      byTab(tabId)?.respawnTab(tabId, shellOverride, cwd, command) ?? false,
    moveWorkspace: (workspaceId: WorkspaceId, toIndex: number) =>
      byWorkspace(workspaceId)?.moveWorkspace(workspaceId, toIndex) ?? false,
    moveWorkspaceBy: (workspaceId: WorkspaceId, delta: number) =>
      byWorkspace(workspaceId)?.moveWorkspaceBy(workspaceId, delta) ?? false,
    swapWorkspaces: (workspaceIdA: WorkspaceId, workspaceIdB: WorkspaceId) => {
      const owner = byWorkspace(workspaceIdA);
      if (!owner || !owner.hasWorkspace(workspaceIdB)) return false;
      return owner.swapWorkspaces(workspaceIdA, workspaceIdB);
    },
    handleInput: (tabId: TabId, data: string) => byTab(tabId)?.handleInput(tabId, data),
    sendInitialInput: (tabId: TabId, data: string) =>
      byTab(tabId)?.sendInitialInput(tabId, data) ?? false,
    handleMouseEvent: (tabId: TabId, ev: MouseEventInput) =>
      byTab(tabId)?.handleMouseEvent(tabId, ev),
    enterCopyMode: (tabId: TabId) => byTab(tabId)?.enterCopyMode(tabId),
    handleCopyModeKey: (tabId: TabId, key: CopyModeKey) =>
      byTab(tabId)?.handleCopyModeKey(tabId, key) ?? false,
    handlePaste: (tabId: TabId, data: string) => byTab(tabId)?.handlePaste(tabId, data),
    handleResize: (
      tabId: TabId,
      cols: number,
      rows: number,
      cellWidthPx: number,
      cellHeightPx: number,
    ) => byTab(tabId)?.handleResize(tabId, cols, rows, cellWidthPx, cellHeightPx),
    handleScroll: (tabId: TabId, deltaLines: number) =>
      byTab(tabId)?.handleScroll(tabId, deltaLines),
    handleScrollToTop: (tabId: TabId) => byTab(tabId)?.handleScrollToTop(tabId),
    handleScrollToBottom: (tabId: TabId) => byTab(tabId)?.handleScrollToBottom(tabId),
    snapshot: (windowId?: WindowId) => managerOf(windowId).snapshot(),
    listWorkspaces: (windowId?: WindowId) => managerOf(windowId).listWorkspaces(),
    isTabVisible: (tabId: TabId) => byTab(tabId)?.isTabVisible(tabId) ?? false,
    clearBell: (tabId: TabId) => byTab(tabId)?.clearBell(tabId) ?? false,
    clearBellOnVisibleTabs: (windowId?: WindowId) => managerOf(windowId).clearBellOnVisibleTabs(),
    getTabName: (tabId: TabId) => byTab(tabId)?.getTabName(tabId) ?? null,
    hasTab: (tabId: TabId) => byTab(tabId) !== undefined,
    hasTile: (tileId: TileId) => byTile(tileId) !== undefined,
    hasWorkspace: (workspaceId: WorkspaceId) => byWorkspace(workspaceId) !== undefined,
    locateTab: (tabId: TabId) => byTab(tabId)?.locateTab(tabId) ?? null,
    locateBrowserTab: (tabId: TabId) => byTab(tabId)?.locateBrowserTab(tabId) ?? null,
    isWorkspaceActive: (workspaceId: WorkspaceId) =>
      byWorkspace(workspaceId)?.isWorkspaceActive(workspaceId) ?? false,
    getActiveWorkspaceId: (windowId?: WindowId) => managerOf(windowId).getActiveWorkspaceId(),
    getTabText: (tabId: TabId) => byTab(tabId)?.getTabText(tabId) ?? null,
    setTabVar: (tabId: TabId, key: string, value: string) =>
      byTab(tabId)?.setTabVar(tabId, key, value) ?? false,
    getTabVar: (tabId: TabId, key: string) =>
      byTab(tabId)?.getTabVar(tabId, key) ?? ({ found: false, reason: "tab-not-found" } as const),
    listTabVars: (tabId: TabId) => byTab(tabId)?.listTabVars(tabId) ?? null,
    findTabsByVar: (key: string, value: string) =>
      [...entries.values()].flatMap((entry) => entry.workspaces.findTabsByVar(key, value)),
    findTabsByVarInBoard: (boardId: BoardId, key: string, value: string) =>
      byBoard(boardId)?.findTabsByVarInBoard(boardId, key, value) ?? null,
    showTab: (tabId: TabId) => {
      const owner = byTab(tabId);
      if (!owner) return false;
      const windowId = windowIdOfTab(tabId);
      if (windowId !== null) focusedId = windowId;
      return owner.showTab(tabId);
    },
    setTabName: (tabId: TabId, name: string) => byTab(tabId)?.setTabName(tabId, name) ?? false,
    setTileName: (tileId: TileId, name: string) =>
      byTile(tileId)?.setTileName(tileId, name) ?? false,
    setWorkspaceName: (workspaceId: WorkspaceId, name: string) =>
      byWorkspace(workspaceId)?.setWorkspaceName(workspaceId, name) ?? false,
    // メインウィンドウの中身だけを書き出す。一時ウィンドウしか残っていない場合は
    // 最後に見えていたメインウィンドウの状態を消さないよう、空のまま返さずpersistentState()を使う
    serializeForPersistence: () => persistentState() ?? focused().serializeForPersistence(),
    applyMaxScrollback,
    dispose,
  };
}

export type WindowManager = ReturnType<typeof createWindowManager>;
