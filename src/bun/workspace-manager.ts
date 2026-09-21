// 複数のWorkspace（createWorkspaceのインスタンス）を束ね、tile/tab/boardのid採番をアプリ全体で
// 一元化する層。bun/index.tsはこのモジュールだけを通してワークスペース・ボード・タイル・タブ・PTYを操作する。
import {
  buildTreeFromPersisted,
  type PersistedBoard,
  type PersistedBoardStartup,
  type PersistedState,
} from "./persistence";
import type { BoardId } from "./board";
import type { CopyModeKey } from "./copy-mode";
import type { MouseEventInput } from "./ghostty";
import type { SplitOrientation, SplitPlacement, TabId, TileId } from "./tile-layout";
import {
  createWorkspace,
  type BoardListEntry,
  type CloseBoardResult,
  type GetTabVarResult,
  type InitialBoard,
  type NewBoardOptions,
  type OpenPopupOptions,
  type Workspace,
  type WorkspaceOptions,
  type WorkspaceRenderState,
} from "./workspace";

export type { CloseBoardResult, GetTabVarResult, NewBoardOptions } from "./workspace";
export type { BoardId } from "./board";

export type WorkspaceId = string;

/**
 * moveBoardToWorkspaceの結果。sourceWorkspaceClosedは移動元が空になって畳まれたかどうかで、
 * CLI・webviewがその旨をユーザーへ伝えるために使う
 */
export type MoveBoardToWorkspaceResult =
  | { ok: true; sourceWorkspaceClosed: boolean }
  | { ok: false; reason: "board-not-found" | "workspace-not-found" };

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

/** listWorkspacesが返すBoard。workspace.tsのBoardListEntryへ、fsを見ないと分からない項目を足したもの */
export interface BoardStatusEntry extends BoardListEntry {
  /** 紐づけワークツリーが見つからないか。紐づけの無いBoardは常にfalse */
  worktreeMissing: boolean;
}

export interface WorkspaceListEntry {
  workspaceId: WorkspaceId;
  active: boolean;
  activeBoardId: BoardId;
  /** サイドバー表示用。このWorkspaceが持つ全Boardのレイアウト骨格（ADR 0006） */
  boards: BoardStatusEntry[];
  /** ユーザーがサイドバーから設定したワークスペース名。未設定はnull（表示側で連番にフォールバック） */
  name: string | null;
  /** このWorkspaceのポップアップ（ADR 0005）。Boardをまたいでも共有される（ADR 0006） */
  popup: { tabId: TabId; visible: boolean } | null;
}

/** listStartupLayoutBoardsの1件 */
export interface StartupLayoutBoard {
  boardId: BoardId;
  preset: string;
  /** プリセットの解決元プロジェクトルート。未設定ならグローバル設定から引く */
  projectRoot?: string;
  /** 紐づけを作った時点の実行ディレクトリ。projectRootが無いときのcwdの基準になる */
  cwd?: string;
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
  /** 新しいタブのcwdをBoardの紐づけワークツリーから決める（省略時は今のタブのcwdを引き継ぐ） */
  getNewTabCwd?: WorkspaceOptions["getNewTabCwd"];
  /**
   * 紐づけワークツリーが消えているかの判定。listWorkspacesのworktreeMissingに載る。
   * 省略時は常に存在扱い（サイドバーに警告アイコンが出ない）
   */
  isWorktreeMissing?: (worktreePath: string) => boolean;
  /** いずれかのタブのPTYがBEL文字(0x07)を出力した時に呼ばれる。マーク・通知の要否判断は呼び出し側の責務 */
  onBell?: WorkspaceOptions["onBell"];
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
      getNewTabCwd: opts.getNewTabCwd,
      onBell: opts.onBell,
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
        const initialBoard: InitialBoard = {};
        if (persistedBoard.name !== undefined) initialBoard.name = persistedBoard.name;
        if (persistedBoard.startup !== undefined) initialBoard.startup = persistedBoard.startup;
        if (persistedBoard.worktreePath !== undefined)
          initialBoard.worktreePath = persistedBoard.worktreePath;
        // 起動時にプリセットで組み直すBoardは骨格を復元しない。単一タブの
        // まっさらな状態で作り、bun/index.tsが設定読み込み後にapplyLayoutPresetで組み立てる。
        // 骨格を復元してから畳むと前回セッションのタブ名・vars・cwdがプリセット適用後も
        // 残ってしまうため（layout-apply.tsのプレースホルダー使い回しを参照）
        if (persistedBoard.startup?.restoreMode === "layout") return initialBoard;
        const restored = buildTreeFromPersisted(persistedBoard.layout, genTileId, genTabId);
        initialBoard.tree = restored.tree;
        initialBoard.restoredMeta = {
          tabMeta: restored.tabMeta,
          tileNames: restored.tileNames,
          focusedTileId: restored.focusedTileId,
        };
        return initialBoard;
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

  /** アクティブなワークスペースで画面に出ているタブ（各タイルのアクティブタブ、ズーム中はそのタイルのみ） */
  function listVisibleTabIds(): TabId[] {
    return (workspaces.get(activeId) as Workspace).listVisibleTabIds();
  }

  function isTabVisible(tabId: TabId): boolean {
    return listVisibleTabIds().includes(tabId);
  }

  /**
   * 画面に出ているタブのベルのマークを消す（表示された＝既読とみなす）。描画の直前に呼ぶ想定のため
   * onDirtyは呼ばず、消したものがあったかどうかだけを返す
   */
  function clearBellOnVisibleTabs(): boolean {
    const ws = workspaces.get(activeId) as Workspace;
    let cleared = false;
    for (const tabId of ws.listVisibleTabIds()) {
      if (ws.clearBell(tabId)) cleared = true;
    }
    return cleared;
  }

  /**
   * ベルのマークを明示的に消す（niwa.bell.clear）。clearBellOnVisibleTabsと違い、
   * 描画のついでではなくユーザーの操作として呼ばれるためonDirtyで描画も促す
   */
  function clearBell(tabId: TabId): boolean {
    const cleared = findOwnerByTabId(tabId)?.clearBell(tabId) ?? false;
    if (cleared) opts.onDirty();
    return cleared;
  }

  /** ユーザーがサイドバーから設定したタブ名。未設定・不存在はnull */
  function getTabName(tabId: TabId): string | null {
    return findOwnerByTabId(tabId)?.getTabName(tabId) ?? null;
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

  /** moveBoardToWorkspace用。インスタンスではなくidが要る（移動元を畳む際にorder・名前も引くため） */
  function findWorkspaceIdByBoardId(boardId: BoardId): WorkspaceId | null {
    for (const [workspaceId, ws] of workspaces) {
      if (ws.hasBoard(boardId)) return workspaceId;
    }
    return null;
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

  function newBoard(
    workspaceId: WorkspaceId,
    cwd?: string,
    options: NewBoardOptions = {},
  ): BoardId | null {
    return workspaces.get(workspaceId)?.newBoard(cwd, options) ?? null;
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

  /**
   * Boardの表示順（サイドバーの並び・未設定時の連番ラベル）の並び替え。所属ワークスペース内で
   * 完結する（別のワークスペースへ移すのはmoveBoardToWorkspace）。toIndexは0始まりで範囲外はクランプする
   */
  function moveBoard(boardId: BoardId, toIndex: number): boolean {
    return findOwnerByBoardId(boardId)?.moveBoard(boardId, toIndex) ?? false;
  }

  /** moveBoardの相対指定版。deltaは-1で1つ前へ、+1で1つ後ろへ（CLIの`board move --up/--down`向け） */
  function moveBoardBy(boardId: BoardId, delta: number): boolean {
    return findOwnerByBoardId(boardId)?.moveBoardBy(boardId, delta) ?? false;
  }

  /**
   * Boardを別のワークスペースへ移す。BoardインスタンスがPTYセッションごと移るため、レイアウト・
   * タブ・実行中のプロセスはそのまま維持される（タブ単体のワークスペース跨ぎ移動が非対応なのとは
   * 事情が違う。moveTab参照）。toIndexは移動先での0始まりの挿入位置で、省略・範囲外は末尾。
   * アクティブなBoardは移動元・移動先とも変更しない。
   * 移動元がこれで空になる場合はそのワークスペースごと畳み（sourceWorkspaceClosed: true）、
   * 表示中だったなら移動先のワークスペースへ切り替える。空になるのが破壊的かどうかの確認は
   * 呼び出し側の責務（webviewはmainview/index.tsが確認ダイアログを出す）
   */
  function moveBoardToWorkspace(
    boardId: BoardId,
    toWorkspaceId: WorkspaceId,
    toIndex?: number,
  ): MoveBoardToWorkspaceResult {
    const target = workspaces.get(toWorkspaceId);
    if (!target) return { ok: false, reason: "workspace-not-found" };
    const sourceId = findWorkspaceIdByBoardId(boardId);
    if (sourceId === null) return { ok: false, reason: "board-not-found" };
    if (sourceId === toWorkspaceId) {
      // 同一ワークスペース内なら並び替えと同じ意味になる（D&Dの取り違え・CLIの指定ミスを
      // エラーにせず吸収する）。挿入位置の指定が無ければ何も動かさない
      if (toIndex !== undefined) moveBoard(boardId, toIndex);
      return { ok: true, sourceWorkspaceClosed: false };
    }
    const source = workspaces.get(sourceId) as Workspace;
    const detached = source.detachBoard(boardId);
    if (!detached) return { ok: false, reason: "board-not-found" };
    target.adoptBoard(detached, toIndex);
    const sourceWorkspaceClosed = source.isEmpty();
    if (sourceWorkspaceClosed) {
      // Boardが0個のワークスペースはactiveBoardIdが何も指さず描画に耐えないため畳む。
      // 移したBoardは既に移動先が抱えているので、disposeで落ちるのはポップアップだけ
      source.dispose();
      workspaces.delete(sourceId);
      workspaceNames.delete(sourceId);
      order = order.filter((id) => id !== sourceId);
      // 表示中のワークスペースが消えた場合は、今移したBoardがある側を見せる
      if (activeId === sourceId) activeId = toWorkspaceId;
    }
    opts.onDirty();
    return { ok: true, sourceWorkspaceClosed };
  }

  function setBoardName(boardId: BoardId, name: string): boolean {
    return findOwnerByBoardId(boardId)?.setBoardName(boardId, name) ?? false;
  }

  /** nullを渡すとプリセットの紐づけを解除する（起動時は保存済みlayoutの復元に戻る） */
  function setBoardStartup(boardId: BoardId, startup: PersistedBoardStartup | null): boolean {
    return findOwnerByBoardId(boardId)?.setBoardStartup(boardId, startup) ?? false;
  }

  function getBoardStartup(boardId: BoardId): PersistedBoardStartup | null {
    return findOwnerByBoardId(boardId)?.getBoardStartup(boardId) ?? null;
  }

  function setBoardWorktreePath(boardId: BoardId, worktreePath: string | null): boolean {
    return findOwnerByBoardId(boardId)?.setBoardWorktreePath(boardId, worktreePath) ?? false;
  }

  function getBoardWorktreePath(boardId: BoardId): string | null {
    return findOwnerByBoardId(boardId)?.getBoardWorktreePath(boardId) ?? null;
  }

  function getBoardFocusedCwd(boardId: BoardId): string | undefined {
    return findOwnerByBoardId(boardId)?.getBoardFocusedCwd(boardId);
  }

  function getBoardFocusedShell(boardId: BoardId): string | undefined {
    return findOwnerByBoardId(boardId)?.getBoardFocusedShell(boardId);
  }

  /**
   * 起動時にレイアウトプリセットで組み直すBoard（restoreMode: "layout"）の一覧。
   * bun/index.tsが設定読み込み後にapplyLayoutPresetを流し込むために使う。
   * projectRootが載っているBoardは、グローバル設定ではなくそのプロジェクトの
   * .niwaterm/config.tsからプリセットを引く。cwdは紐づけを作った時点の実行ディレクトリで、
   * projectRootが無いBoardのタブのcwdの基準になる
   */
  function listStartupLayoutBoards(): StartupLayoutBoard[] {
    const result: StartupLayoutBoard[] = [];
    for (const ws of order) {
      for (const board of (workspaces.get(ws) as Workspace).listBoards()) {
        if (board.startup?.restoreMode === "layout") {
          const entry: StartupLayoutBoard = {
            boardId: board.boardId,
            preset: board.startup.preset,
          };
          if (board.startup.projectRoot !== undefined) {
            entry.projectRoot = board.startup.projectRoot;
          }
          if (board.startup.cwd !== undefined) {
            entry.cwd = board.startup.cwd;
          }
          result.push(entry);
        }
      }
    }
    return result;
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

  function cycleTab(tileId: TileId, delta: 1 | -1): boolean {
    return findOwnerByTileId(tileId)?.cycleTab(tileId, delta) ?? false;
  }

  // ドラッグ&ドロップによるタブ移動。PTYセッションはWorkspaceインスタンスのクロージャ内に
  // 閉じているため、workspaceをまたぐ移動はセッションの移管が必要になり非対応（無視してfalseを返す）
  function moveTab(fromTileId: TileId, tabId: TabId, toTileId: TileId): boolean {
    const owner = findOwnerByTileId(fromTileId);
    if (!owner || owner !== findOwnerByTileId(toTileId)) return false;
    return owner.moveTab(fromTileId, tabId, toTileId);
  }

  // タブをタイルの端へドロップしての画面分割。moveTabと同じくBoardをまたぐ操作は非対応
  function moveTabToSplit(
    fromTileId: TileId,
    tabId: TabId,
    targetTileId: TileId,
    orientation: SplitOrientation,
    placement: SplitPlacement,
  ): boolean {
    const owner = findOwnerByTileId(fromTileId);
    if (!owner || owner !== findOwnerByTileId(targetTileId)) return false;
    return owner.moveTabToSplit(fromTileId, tabId, targetTileId, orientation, placement);
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

  /**
   * 表示順（サイドバー・ウィンドウタイトルの番号）の並び替え。orderの位置だけを動かし、
   * 各ワークスペースの中身（レイアウト・タブ）とアクティブワークスペースは変更しない。
   * toIndexは0始まりで、範囲外はクランプする（端へのD&D・キーバインド連打が失敗扱いに
   * ならないようにするため）。falseを返すのはworkspaceIdが無い・toIndexが数値として不正な場合のみ
   */
  function moveWorkspace(workspaceId: WorkspaceId, toIndex: number): boolean {
    const fromIndex = order.indexOf(workspaceId);
    if (fromIndex === -1 || !Number.isFinite(toIndex)) return false;
    const clamped = Math.min(Math.max(0, Math.trunc(toIndex)), order.length - 1);
    if (clamped === fromIndex) return true;
    order.splice(fromIndex, 1);
    order.splice(clamped, 0, workspaceId);
    opts.onDirty();
    return true;
  }

  /** moveWorkspaceの相対指定版。deltaは-1で1つ前へ、+1で1つ後ろへ（CLIの`workspace move --up/--down`向け） */
  function moveWorkspaceBy(workspaceId: WorkspaceId, delta: number): boolean {
    const fromIndex = order.indexOf(workspaceId);
    if (fromIndex === -1) return false;
    return moveWorkspace(workspaceId, fromIndex + delta);
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
        // worktreeMissingだけはfsを見る必要があるためWorkspaceの外で足す（workspace.tsをfs非依存に保つ）
        boards: ws.listBoards().map((board) => ({
          ...board,
          worktreeMissing:
            board.worktreePath !== null && (opts.isWorktreeMissing?.(board.worktreePath) ?? false),
        })),
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
          const board: PersistedBoard = { layout: b.layout };
          if (b.name !== undefined) board.name = b.name;
          if (b.startup !== undefined) board.startup = b.startup;
          if (b.worktreePath !== undefined) board.worktreePath = b.worktreePath;
          return board;
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
    moveBoard,
    moveBoardBy,
    moveBoardToWorkspace,
    setBoardName,
    setBoardStartup,
    getBoardStartup,
    setBoardWorktreePath,
    getBoardWorktreePath,
    getBoardFocusedCwd,
    getBoardFocusedShell,
    listStartupLayoutBoards,
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
    cycleTab,
    moveTab,
    moveTabToSplit,
    closeTab,
    focusTile,
    focusDirection,
    toggleZoomTile,
    getFocusedTileId,
    getActiveTabId,
    resizeSplit,
    resizeTileInDirection,
    respawnTab,
    moveWorkspace,
    moveWorkspaceBy,
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
    isTabVisible,
    clearBell,
    clearBellOnVisibleTabs,
    getTabName,
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
