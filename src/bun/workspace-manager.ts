// 複数のWorkspace（createWorkspaceのインスタンス）を束ね、tile/tab/boardのid採番をアプリ全体で
// 一元化する層。bun/index.tsはこのモジュールだけを通してワークスペース・ボード・タイル・タブ・PTYを操作する。
import {
  buildTreeFromPersisted,
  type PersistedBoard,
  type PersistedState,
  type RestoredTreeMeta,
} from "./persistence";
import type { BoardId } from "./board";
import type { CopyModeKey } from "./copy-mode";
import type { MouseEventInput } from "./ghostty";
import type { SplitOrientation, TabId, TileId } from "./tile-layout";
import {
  createWorkspace,
  type BoardListEntry,
  type CloseBoardResult,
  type GetTabVarResult,
  type InitialBoard,
  type OpenPopupOptions,
  type Workspace,
  type WorkspaceOptions,
  type WorkspaceRenderState,
} from "./workspace";

export type { CloseBoardResult, GetTabVarResult } from "./workspace";
export type { BoardId } from "./board";

export type WorkspaceId = string;

export type CloseWorkspaceResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "last-workspace" };

export interface AppRenderState {
  activeWorkspaceId: WorkspaceId;
  /** 表示順。ウィンドウタイトルの "2/3" 表示に使う */
  workspaceIds: WorkspaceId[];
  /** アクティブなワークスペースの描画データのみ（非表示ワークスペース分は送らない） */
  workspace: WorkspaceRenderState;
  /** サイドバー描画用。全ワークスペースのレイアウト骨格（PTY内容は含まない、listWorkspaces()と同一データ） */
  workspaces: WorkspaceListEntry[];
}

export interface WorkspaceListEntry {
  workspaceId: WorkspaceId;
  active: boolean;
  activeBoardId: BoardId;
  /** サイドバー表示用。このWorkspaceが持つ全Boardのレイアウト骨格（ADR 0006） */
  boards: BoardListEntry[];
  /** ユーザーがサイドバーから設定したワークスペース名。未設定はnull（表示側で連番にフォールバック） */
  name: string | null;
  /** このWorkspaceのポップアップ（ADR 0005）。Boardをまたいでも共有される（ADR 0006） */
  popup: { tabId: TabId; visible: boolean } | null;
}

export interface TabLocation {
  workspaceId: WorkspaceId;
  boardId: BoardId;
  tileId: TileId;
}

export interface WorkspaceManagerOptions {
  initialCols: number;
  initialRows: number;
  /** 描画すべき変化が生じた時に呼ばれる。描画スケジューリングは呼び出し側の責務 */
  onDirty: () => void;
  /** 最後の1ワークスペースの最後のタブが閉じられた時に呼ばれる。アプリを終了するかどうかの判断は呼び出し側の責務 */
  onAllWorkspacesClosed: () => void;
  /** 起動時に読み込んだ永続化データ。省略時・無効時は単一ワークスペース・単一タブで初期化する */
  restoreFrom?: PersistedState | null;
  /** 新規タブ作成時に使うデフォルトシェルを取得する。省略時はpty.ts側のOS標準シェルを使う */
  getDefaultShell?: WorkspaceOptions["getDefaultShell"];
  /** 新規ワークスペース作成時の最初のタブに使うデフォルトcwdを取得する。省略時はpty.ts側のOS標準ホームディレクトリを使う */
  getDefaultCwd?: WorkspaceOptions["getDefaultCwd"];
  /** テスト時にfakeへ差し替えるためのDI */
  createSession?: WorkspaceOptions["createSession"];
}

export function createWorkspaceManager(opts: WorkspaceManagerOptions) {
  const workspaces = new Map<WorkspaceId, Workspace>();
  let order: WorkspaceId[] = [];
  let activeId: WorkspaceId;
  // ワークスペース名。serializeForPersistence経由で永続化対象になる
  const workspaceNames = new Map<WorkspaceId, string>();

  let counter = 0;
  const genTileId = (): TileId => `tile-${counter++}`;
  const genTabId = (): TabId => `tab-${counter++}`;
  const genBoardId = (): BoardId => `board-${counter++}`;
  const genWorkspaceId = (): WorkspaceId => `workspace-${counter++}`;

  function createAndRegisterWorkspace(
    initialBoards?: InitialBoard[],
    activeBoardIndex?: number,
    initialCwd?: string,
  ): WorkspaceId {
    const id = genWorkspaceId();
    const ws = createWorkspace({
      initialCols: opts.initialCols,
      initialRows: opts.initialRows,
      genTileId,
      genTabId,
      genBoardId,
      initialBoards,
      activeBoardIndex,
      initialCwd,
      onDirty: () => opts.onDirty(),
      onAllTabsClosed: () => handleWorkspaceEmptied(id),
      getDefaultShell: opts.getDefaultShell,
      getDefaultCwd: opts.getDefaultCwd,
      createSession: opts.createSession,
    });
    workspaces.set(id, ws);
    order.push(id);
    return id;
  }

  // あるworkspaceの最後のboard・最後のタイル・最後のタブが閉じられた時の挙動。
  // そのworkspace自体を削除し、他のworkspaceへ切り替える。最後の1つだった場合のみアプリを終了する。
  function handleWorkspaceEmptied(id: WorkspaceId): void {
    workspaces.get(id)?.dispose();
    workspaces.delete(id);
    workspaceNames.delete(id);
    order = order.filter((wid) => wid !== id);
    if (order.length === 0) {
      opts.onAllWorkspacesClosed();
      return;
    }
    if (activeId === id) {
      activeId = order[order.length - 1];
    }
    opts.onDirty();
  }

  const restoreFrom = opts.restoreFrom;
  if (restoreFrom && restoreFrom.workspaces.length > 0) {
    for (const persistedWorkspace of restoreFrom.workspaces) {
      const initialBoards: InitialBoard[] = persistedWorkspace.boards.map((persistedBoard) => {
        const restored = buildTreeFromPersisted(persistedBoard.layout, genTileId, genTabId);
        const restoredMeta: RestoredTreeMeta = {
          tabMeta: restored.tabMeta,
          tileNames: restored.tileNames,
          focusedTileId: restored.focusedTileId,
        };
        return persistedBoard.name !== undefined
          ? { tree: restored.tree, name: persistedBoard.name, restoredMeta }
          : { tree: restored.tree, restoredMeta };
      });
      const id = createAndRegisterWorkspace(initialBoards, persistedWorkspace.activeBoardIndex);
      // setWorkspaceNameは経由しない（onDirtyを呼ぶため。初期構築フェーズはdirty通知しない既存方針）
      if (persistedWorkspace.name !== undefined) workspaceNames.set(id, persistedWorkspace.name);
    }
    const clampedIndex = Math.min(Math.max(0, restoreFrom.activeWorkspaceIndex), order.length - 1);
    activeId = order[clampedIndex];
  } else {
    activeId = createAndRegisterWorkspace();
  }

  function findOwnerByTileId(tileId: TileId): Workspace | undefined {
    for (const ws of workspaces.values()) {
      if (ws.hasTile(tileId)) return ws;
    }
    return undefined;
  }

  function findOwnerByTabId(tabId: TabId): Workspace | undefined {
    for (const ws of workspaces.values()) {
      if (ws.hasTab(tabId)) return ws;
    }
    return undefined;
  }

  function findOwnerByBoardId(boardId: BoardId): Workspace | undefined {
    for (const ws of workspaces.values()) {
      if (ws.hasBoard(boardId)) return ws;
    }
    return undefined;
  }

  /** 種別（terminal/browser）を問わずtabIdの所在を返す。tab show用 */
  function locateTab(tabId: TabId): TabLocation | null {
    for (const [workspaceId, ws] of workspaces) {
      const location = ws.locateTab(tabId);
      if (location) return { workspaceId, boardId: location.boardId, tileId: location.tileId };
    }
    return null;
  }

  /** ブラウザタブに限定した所在確認。terminalタブはnullを返す */
  function locateBrowserTab(tabId: TabId): TabLocation | null {
    for (const [workspaceId, ws] of workspaces) {
      const location = ws.locateBrowserTab(tabId);
      if (location) return { workspaceId, boardId: location.boardId, tileId: location.tileId };
    }
    return null;
  }

  function isWorkspaceActive(workspaceId: WorkspaceId): boolean {
    return workspaceId === activeId;
  }

  // niwa.workspace.current向け（tmuxのswitch-clientで参照するcurrent-window相当）
  function getActiveWorkspaceId(): WorkspaceId {
    return activeId;
  }

  function newWorkspace(cwd?: string): WorkspaceId {
    activeId = createAndRegisterWorkspace(undefined, undefined, cwd);
    opts.onDirty();
    return activeId;
  }

  function switchWorkspace(workspaceId: WorkspaceId): boolean {
    if (!workspaces.has(workspaceId)) return false;
    if (activeId !== workspaceId) {
      activeId = workspaceId;
      opts.onDirty();
    }
    return true;
  }

  function closeWorkspace(workspaceId: WorkspaceId): CloseWorkspaceResult {
    if (!workspaces.has(workspaceId)) return { ok: false, reason: "not-found" };
    if (workspaces.size === 1) return { ok: false, reason: "last-workspace" }; // 最後の1つは閉じない（誤操作防止）
    workspaces.get(workspaceId)?.dispose();
    workspaces.delete(workspaceId);
    workspaceNames.delete(workspaceId);
    order = order.filter((id) => id !== workspaceId);
    if (activeId === workspaceId) {
      activeId = order[order.length - 1];
    }
    opts.onDirty();
    return { ok: true };
  }

  function newBoard(workspaceId: WorkspaceId, cwd?: string): BoardId | null {
    return workspaces.get(workspaceId)?.newBoard(cwd) ?? null;
  }

  function hasBoard(boardId: BoardId): boolean {
    return findOwnerByBoardId(boardId) !== undefined;
  }

  function switchBoard(boardId: BoardId): boolean {
    return findOwnerByBoardId(boardId)?.switchBoard(boardId) ?? false;
  }

  function closeBoard(boardId: BoardId): CloseBoardResult {
    const owner = findOwnerByBoardId(boardId);
    if (!owner) return { ok: false, reason: "not-found" };
    return owner.closeBoard(boardId);
  }

  function setBoardName(boardId: BoardId, name: string): boolean {
    return findOwnerByBoardId(boardId)?.setBoardName(boardId, name) ?? false;
  }

  function splitTile(
    tileId: TileId,
    orientation: SplitOrientation,
    ratio?: number,
    cwd?: string,
  ): { tileId: TileId; tabId: TabId } | null {
    return findOwnerByTileId(tileId)?.splitTile(tileId, orientation, ratio, cwd) ?? null;
  }

  function newTab(tileId: TileId, shellOverride?: string, cwd?: string): TabId | null {
    return findOwnerByTileId(tileId)?.newTab(tileId, shellOverride, cwd) ?? null;
  }

  function newBrowserTab(tileId: TileId, url: string): TabId | null {
    return findOwnerByTileId(tileId)?.newBrowserTab(tileId, url) ?? null;
  }

  // ポップアップはワークスペースごとの状態のため「現在アクティブなワークスペース」へルーティングする
  // （focusDirectionと同様、idを取らない例外的な操作。ADR 0005。
  // Boardをまたいでも同じポップアップを使えるようworkspace.ts側でBoard横断の単一状態として保持する。ADR 0006）
  function openPopup(popupOpts?: OpenPopupOptions): TabId | null {
    return workspaces.get(activeId)?.openPopup(popupOpts) ?? null;
  }

  function closePopup(): boolean {
    return workspaces.get(activeId)?.closePopup() ?? false;
  }

  // openPopup直後（同期的、間にawaitを挟まない）に呼ぶ前提。呼び出し時点のactiveIdを
  // 見るため、待機中にワークスペースが切り替わっても開いた時点のポップアップを見続ける
  function waitForPopupClose(): Promise<string | undefined> {
    return workspaces.get(activeId)?.waitForPopupClose() ?? Promise.resolve(undefined);
  }

  function togglePopupVisibility(): boolean | null {
    return workspaces.get(activeId)?.togglePopupVisibility() ?? null;
  }

  // ポップアップの昇格も同様に「現在アクティブなワークスペース」固定でルーティングする
  // （openPopup/closePopup/togglePopupVisibilityと同じ例外パターン。昇格先は各ワークスペースが
  // 保持するfocusedTileId固定のため、tileId引数を取らない。ADR 0005）
  function promotePopup(): { tileId: TileId; tabId: TabId } | null {
    return workspaces.get(activeId)?.promotePopup() ?? null;
  }

  // findOwnerByTabId（ws.hasTabベース）はterminalタブしか見つけられないため、
  // browserタブはWorkspace側のsetBrowserTabUrlを直接全workspace横断で試す
  function setBrowserTabUrl(tabId: TabId, url: string): boolean {
    for (const ws of workspaces.values()) {
      if (ws.setBrowserTabUrl(tabId, url)) return true;
    }
    return false;
  }

  function switchTab(tileId: TileId, tabId: TabId): boolean {
    return findOwnerByTileId(tileId)?.switchTab(tileId, tabId) ?? false;
  }

  // ドラッグ&ドロップによるタブ移動。PTYセッションはWorkspaceインスタンスのクロージャ内に
  // 閉じているため、workspaceをまたぐ移動はセッションの移管が必要になり非対応（無視してfalseを返す）
  function moveTab(fromTileId: TileId, tabId: TabId, toTileId: TileId): boolean {
    const owner = findOwnerByTileId(fromTileId);
    if (!owner || owner !== findOwnerByTileId(toTileId)) return false;
    return owner.moveTab(fromTileId, tabId, toTileId);
  }

  function closeTab(tileId: TileId, tabId: TabId): boolean {
    return findOwnerByTileId(tileId)?.closeTab(tileId, tabId) ?? false;
  }

  function focusTile(tileId: TileId): boolean {
    return findOwnerByTileId(tileId)?.focusTile(tileId) ?? false;
  }

  // niwa.tile.zoom / CLIのtile zoom向け（tmuxのresize-pane -Z相当）。tileId不存在はnull、
  // それ以外はトグル後のズーム状態（true=ズーム中）を返す
  function toggleZoomTile(tileId: TileId): boolean | null {
    return findOwnerByTileId(tileId)?.toggleZoomTile(tileId) ?? null;
  }

  // 「現在フォーカス」基準の操作のため例外的にidを取らず、アクティブなworkspaceへルーティングする
  function focusDirection(direction: "up" | "down" | "left" | "right"): void {
    workspaces.get(activeId)?.focusDirection(direction);
  }

  // niwa APIのniwa.tile.current()向け。focusDirectionと同じくアクティブworkspace固定の例外的操作
  function getFocusedTileId(): TileId {
    return (workspaces.get(activeId) as Workspace).getFocusedTileId();
  }

  function getActiveTabId(tileId: TileId): TabId | null {
    return findOwnerByTileId(tileId)?.getActiveTabId(tileId) ?? null;
  }

  function resizeSplit(splitId: TileId, ratio: number): void {
    findOwnerByTileId(splitId)?.resizeSplit(splitId, ratio);
  }

  // niwa.tile.resize向け（tmuxのresize-pane相当）
  function resizeTileInDirection(
    tileId: TileId,
    direction: "up" | "down" | "left" | "right",
    delta: number,
  ): boolean {
    return findOwnerByTileId(tileId)?.resizeTileInDirection(tileId, direction, delta) ?? false;
  }

  // niwa.tab.respawn向け（tmuxのrespawn-pane相当）
  function respawnTab(
    tabId: TabId,
    shellOverride?: string,
    cwd?: string,
    command?: string,
  ): boolean {
    return findOwnerByTabId(tabId)?.respawnTab(tabId, shellOverride, cwd, command) ?? false;
  }

  // niwa.workspace.swap向け（tmuxのswap-window相当）。orderの位置を交換するだけで
  // 各ワークスペースの中身（レイアウト・タブ）は一切変更しない
  function swapWorkspaces(workspaceIdA: WorkspaceId, workspaceIdB: WorkspaceId): boolean {
    if (workspaceIdA === workspaceIdB) return false;
    const indexA = order.indexOf(workspaceIdA);
    const indexB = order.indexOf(workspaceIdB);
    if (indexA === -1 || indexB === -1) return false;
    [order[indexA], order[indexB]] = [order[indexB], order[indexA]];
    opts.onDirty();
    return true;
  }

  function handleInput(tabId: TabId, data: string): void {
    findOwnerByTabId(tabId)?.handleInput(tabId, data);
  }

  /** board.tsのsendInitialInput参照。PTY起動待ちのタブにも届く入力送信 */
  function sendInitialInput(tabId: TabId, data: string): boolean {
    return findOwnerByTabId(tabId)?.sendInitialInput(tabId, data) ?? false;
  }

  function handlePaste(tabId: TabId, data: string): void {
    findOwnerByTabId(tabId)?.handlePaste(tabId, data);
  }

  function handleMouseEvent(tabId: TabId, ev: MouseEventInput): void {
    findOwnerByTabId(tabId)?.handleMouseEvent(tabId, ev);
  }

  function enterCopyMode(tabId: TabId): void {
    findOwnerByTabId(tabId)?.enterCopyMode(tabId);
  }

  function handleCopyModeKey(tabId: TabId, key: CopyModeKey): boolean {
    return findOwnerByTabId(tabId)?.handleCopyModeKey(tabId, key) ?? false;
  }

  function handleScroll(tabId: TabId, deltaLines: number): void {
    findOwnerByTabId(tabId)?.handleScroll(tabId, deltaLines);
  }

  function handleScrollToTop(tabId: TabId): void {
    findOwnerByTabId(tabId)?.handleScrollToTop(tabId);
  }

  function handleScrollToBottom(tabId: TabId): void {
    findOwnerByTabId(tabId)?.handleScrollToBottom(tabId);
  }

  function handleResize(
    tabId: TabId,
    cols: number,
    rows: number,
    cellWidthPx: number,
    cellHeightPx: number,
  ): void {
    findOwnerByTabId(tabId)?.handleResize(tabId, cols, rows, cellWidthPx, cellHeightPx);
  }

  function listWorkspaces(): WorkspaceListEntry[] {
    return order.map((id) => {
      const ws = workspaces.get(id) as Workspace;
      return {
        workspaceId: id,
        active: id === activeId,
        activeBoardId: ws.getActiveBoardId(),
        boards: ws.listBoards(),
        name: workspaceNames.get(id) ?? null,
        popup: ws.getPopupInfo(),
      };
    });
  }

  function hasTab(tabId: TabId): boolean {
    return findOwnerByTabId(tabId) !== undefined;
  }

  function getTabText(tabId: TabId): string | null {
    return findOwnerByTabId(tabId)?.getTabText(tabId) ?? null;
  }

  function setTabVar(tabId: TabId, key: string, value: string): boolean {
    return findOwnerByTabId(tabId)?.setTabVar(tabId, key, value) ?? false;
  }

  function getTabVar(tabId: TabId, key: string): GetTabVarResult {
    const owner = findOwnerByTabId(tabId);
    if (!owner) return { found: false, reason: "tab-not-found" };
    return owner.getTabVar(tabId, key);
  }

  function listTabVars(tabId: TabId): Record<string, string> | null {
    return findOwnerByTabId(tabId)?.listTabVars(tabId) ?? null;
  }

  // niwa.tab.var.find向け。全ワークスペース・ボード・タイル・タブを横断して、指定キーの値がvalueと
  // 一致するタブを探す（tmuxの`list-panes -F "#{pane_id} #{@role}"` | awk相当。role変数を使った
  // ペインフォーカス移動などに使う）
  function findTabsByVar(key: string, value: string): TabId[] {
    const result: TabId[] = [];
    for (const ws of workspaces.values()) {
      result.push(...ws.findTabsByVar(key, value));
    }
    return result;
  }

  // CLIの`tab var find`向け。指定Board内だけで検索する。ADR 0006で`layout apply`の適用先がBoard単位に
  // なったため、「同じレイアウトプリセット内のタブ」= 同じBoard内のタブ。1つのWorkspaceへ同じプリセットを
  // 複数回適用してもrole名が別Boardのタブと混線しない。boardIdが存在しない場合はnull
  function findTabsByVarInBoard(boardId: BoardId, key: string, value: string): TabId[] | null {
    const owner = findOwnerByBoardId(boardId);
    if (!owner) return null;
    return owner.findTabsByVarInBoard(boardId, key, value);
  }

  // niwa.tab.show向け（tmuxのselect-pane、CLIの`tab show`相当）。所属ワークスペース・boardへの切替・
  // タイルフォーカス・タブのアクティブ化をまとめて行う。ウィンドウ前面化はCLI版(ipc-server.tsの
  // /show-tab)のみの責務（niwa APIはniwatermウィンドウ内から呼ばれるため不要）
  function showTab(tabId: TabId): boolean {
    const location = locateTab(tabId);
    if (!location) return false;
    switchWorkspace(location.workspaceId);
    workspaces.get(location.workspaceId)?.switchBoard(location.boardId);
    focusTile(location.tileId);
    switchTab(location.tileId, tabId);
    return true;
  }

  function setTabName(tabId: TabId, name: string): boolean {
    return findOwnerByTabId(tabId)?.setTabName(tabId, name) ?? false;
  }

  function setTileName(tileId: TileId, name: string): boolean {
    return findOwnerByTileId(tileId)?.setTileName(tileId, name) ?? false;
  }

  /** 空文字列（trim後）を渡すとデフォルトの連番ラベルへ戻す */
  function setWorkspaceName(workspaceId: WorkspaceId, name: string): boolean {
    if (!workspaces.has(workspaceId)) return false;
    if (name.trim() === "") {
      workspaceNames.delete(workspaceId);
    } else {
      workspaceNames.set(workspaceId, name);
    }
    opts.onDirty();
    return true;
  }

  function snapshot(): AppRenderState {
    // activeIdは常にworkspacesの有効なキーを指す（newWorkspace/switchWorkspace/closeWorkspace/
    // handleWorkspaceEmptiedのいずれも、削除時は必ず残存するidへ付け替えてから返す）
    const active = workspaces.get(activeId) as Workspace;
    return {
      activeWorkspaceId: activeId,
      workspaceIds: [...order],
      workspace: active.snapshot(),
      workspaces: listWorkspaces(),
    };
  }

  function serializeForPersistence(): PersistedState {
    return {
      version: 3,
      workspaces: order.map((id) => {
        const ws = workspaces.get(id) as Workspace;
        const boards: PersistedBoard[] = ws.getPersistableBoards().map((b) => {
          return b.name !== undefined ? { layout: b.layout, name: b.name } : { layout: b.layout };
        });
        const name = workspaceNames.get(id);
        const activeBoardIndex = ws.getActiveBoardIndex();
        return name !== undefined
          ? { boards, activeBoardIndex, name }
          : { boards, activeBoardIndex };
      }),
      activeWorkspaceIndex: order.indexOf(activeId),
    };
  }

  function dispose(): void {
    for (const ws of workspaces.values()) ws.dispose();
    workspaces.clear();
  }

  return {
    newWorkspace,
    switchWorkspace,
    closeWorkspace,
    newBoard,
    hasBoard,
    switchBoard,
    closeBoard,
    setBoardName,
    splitTile,
    newTab,
    newBrowserTab,
    setBrowserTabUrl,
    openPopup,
    closePopup,
    waitForPopupClose,
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
    swapWorkspaces,
    handleInput,
    sendInitialInput,
    handleMouseEvent,
    enterCopyMode,
    handleCopyModeKey,
    handlePaste,
    handleResize,
    handleScroll,
    handleScrollToTop,
    handleScrollToBottom,
    snapshot,
    listWorkspaces,
    hasTab,
    locateTab,
    locateBrowserTab,
    isWorkspaceActive,
    getActiveWorkspaceId,
    getTabText,
    setTabVar,
    getTabVar,
    listTabVars,
    findTabsByVar,
    findTabsByVarInBoard,
    showTab,
    setTabName,
    setTileName,
    setWorkspaceName,
    serializeForPersistence,
    dispose,
  };
}

export type WorkspaceManager = ReturnType<typeof createWorkspaceManager>;
