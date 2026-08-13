// 複数のWorkspace（createWorkspaceのインスタンス）を束ね、tile/tabのid採番をアプリ全体で
// 一元化する層。bun/index.tsはこのモジュールだけを通してワークスペース・タイル・タブ・PTYを操作する。
import { buildTreeFromPersisted, toPersistedTileNode, type PersistedState } from "./persistence";
import {
  findNode,
  listLeaves,
  type SplitOrientation,
  type TabId,
  type TileId,
  type TileNode,
} from "./tile-layout";
import {
  createWorkspace,
  type GetTabVarResult,
  type Workspace,
  type WorkspaceOptions,
  type WorkspaceRenderState,
} from "./workspace";

export type { GetTabVarResult } from "./workspace";

export type WorkspaceId = string;

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
  focusedTileId: TileId;
  layout: TileNode;
  /** サイドバー表示用。タブごとのkey-value変数（branch等） */
  tabVars: Record<TabId, Record<string, string>>;
  /** ユーザーがサイドバーから設定したタブ名。未設定のタブは含まれない */
  tabNames: Record<TabId, string>;
  /** ユーザーがサイドバーから設定したタイル名。未設定のタイルは含まれない */
  tileNames: Record<TileId, string>;
}

export interface TabLocation {
  workspaceId: WorkspaceId;
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
  /** テスト時にfakeへ差し替えるためのDI */
  createSession?: WorkspaceOptions["createSession"];
}

export function createWorkspaceManager(opts: WorkspaceManagerOptions) {
  const workspaces = new Map<WorkspaceId, Workspace>();
  let order: WorkspaceId[] = [];
  let activeId: WorkspaceId;

  let counter = 0;
  const genTileId = (): TileId => `tile-${counter++}`;
  const genTabId = (): TabId => `tab-${counter++}`;
  const genWorkspaceId = (): WorkspaceId => `workspace-${counter++}`;

  function createAndRegisterWorkspace(initialTree?: TileNode): WorkspaceId {
    const id = genWorkspaceId();
    const ws = createWorkspace({
      initialCols: opts.initialCols,
      initialRows: opts.initialRows,
      genTileId,
      genTabId,
      initialTree,
      onDirty: () => opts.onDirty(),
      onAllTabsClosed: () => handleWorkspaceEmptied(id),
      getDefaultShell: opts.getDefaultShell,
      createSession: opts.createSession,
    });
    workspaces.set(id, ws);
    order.push(id);
    return id;
  }

  // あるworkspaceの最後のタイル・最後のタブが閉じられた時の挙動。
  // そのworkspace自体を削除し、他のworkspaceへ切り替える。最後の1つだった場合のみアプリを終了する。
  function handleWorkspaceEmptied(id: WorkspaceId): void {
    workspaces.get(id)?.dispose();
    workspaces.delete(id);
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
      createAndRegisterWorkspace(
        buildTreeFromPersisted(persistedWorkspace.layout, genTileId, genTabId),
      );
    }
    const clampedIndex = Math.min(Math.max(0, restoreFrom.activeWorkspaceIndex), order.length - 1);
    activeId = order[clampedIndex];
  } else {
    activeId = createAndRegisterWorkspace();
  }

  function findOwnerByTileId(tileId: TileId): Workspace | undefined {
    for (const ws of workspaces.values()) {
      if (findNode(ws.getLayout(), tileId)) return ws;
    }
    return undefined;
  }

  function findOwnerByTabId(tabId: TabId): Workspace | undefined {
    for (const ws of workspaces.values()) {
      if (ws.hasTab(tabId)) return ws;
    }
    return undefined;
  }

  /** 種別（terminal/browser）を問わずtabIdの所在を返す。show-tab用 */
  function locateTab(tabId: TabId): TabLocation | null {
    for (const [workspaceId, ws] of workspaces) {
      const tileId = ws.findTileIdForTab(tabId);
      if (tileId) return { workspaceId, tileId };
    }
    return null;
  }

  /** ブラウザタブに限定した所在確認。terminalタブはnullを返す */
  function locateBrowserTab(tabId: TabId): TabLocation | null {
    for (const [workspaceId, ws] of workspaces) {
      if (!ws.hasBrowserTab(tabId)) continue;
      const tileId = ws.findTileIdForTab(tabId);
      if (tileId) return { workspaceId, tileId };
    }
    return null;
  }

  function isWorkspaceActive(workspaceId: WorkspaceId): boolean {
    return workspaceId === activeId;
  }

  function newWorkspace(): void {
    activeId = createAndRegisterWorkspace();
    opts.onDirty();
  }

  function switchWorkspace(workspaceId: WorkspaceId): void {
    if (!workspaces.has(workspaceId) || activeId === workspaceId) return;
    activeId = workspaceId;
    opts.onDirty();
  }

  function closeWorkspace(workspaceId: WorkspaceId): void {
    if (workspaces.size === 1 || !workspaces.has(workspaceId)) return; // 最後の1つは閉じない（誤操作防止）
    workspaces.get(workspaceId)?.dispose();
    workspaces.delete(workspaceId);
    order = order.filter((id) => id !== workspaceId);
    if (activeId === workspaceId) {
      activeId = order[order.length - 1];
    }
    opts.onDirty();
  }

  function splitTile(
    tileId: TileId,
    orientation: SplitOrientation,
  ): { tileId: TileId; tabId: TabId } | null {
    return findOwnerByTileId(tileId)?.splitTile(tileId, orientation) ?? null;
  }

  function newTab(tileId: TileId, shellOverride?: string): TabId | null {
    return findOwnerByTileId(tileId)?.newTab(tileId, shellOverride) ?? null;
  }

  function newBrowserTab(tileId: TileId, url: string): TabId | null {
    return findOwnerByTileId(tileId)?.newBrowserTab(tileId, url) ?? null;
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

  // 「現在フォーカス」基準の操作のため例外的にidを取らず、アクティブなworkspaceへルーティングする
  function focusDirection(direction: "up" | "down" | "left" | "right"): void {
    workspaces.get(activeId)?.focusDirection(direction);
  }

  function resizeSplit(splitId: TileId, ratio: number): void {
    findOwnerByTileId(splitId)?.resizeSplit(splitId, ratio);
  }

  function handleInput(tabId: TabId, data: string): void {
    findOwnerByTabId(tabId)?.handleInput(tabId, data);
  }

  function handlePaste(tabId: TabId, data: string): void {
    findOwnerByTabId(tabId)?.handlePaste(tabId, data);
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
      const layout = ws.getLayout();
      const tabVars: Record<TabId, Record<string, string>> = {};
      for (const leaf of listLeaves(layout)) {
        for (const tabId of leaf.tabIds) {
          tabVars[tabId] = ws.listTabVars(tabId) ?? {};
        }
      }
      return {
        workspaceId: id,
        active: id === activeId,
        focusedTileId: ws.getFocusedTileId(),
        layout,
        tabVars,
        tabNames: ws.listTabNames(),
        tileNames: ws.listTileNames(),
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

  function setTabName(tabId: TabId, name: string): boolean {
    return findOwnerByTabId(tabId)?.setTabName(tabId, name) ?? false;
  }

  function setTileName(tileId: TileId, name: string): boolean {
    return findOwnerByTileId(tileId)?.setTileName(tileId, name) ?? false;
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
      version: 1,
      workspaces: order.map((id) => ({
        layout: toPersistedTileNode((workspaces.get(id) as Workspace).getLayout()),
      })),
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
    splitTile,
    newTab,
    newBrowserTab,
    switchTab,
    moveTab,
    closeTab,
    focusTile,
    focusDirection,
    resizeSplit,
    handleInput,
    handlePaste,
    handleResize,
    snapshot,
    listWorkspaces,
    hasTab,
    locateTab,
    locateBrowserTab,
    isWorkspaceActive,
    getTabText,
    setTabVar,
    getTabVar,
    listTabVars,
    setTabName,
    setTileName,
    serializeForPersistence,
    dispose,
  };
}

export type WorkspaceManager = ReturnType<typeof createWorkspaceManager>;
