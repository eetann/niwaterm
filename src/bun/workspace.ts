// 複数のBoard（createBoardのインスタンス）を束ね、Boardの切り替え・作成・削除を管理する層（ADR 0006）。
// workspace-manager.tsが複数Workspaceを束ねるのと同じパターンを、Workspace内で複数Boardへ1段複製したもの。
// tile/tabのid採番は既存方針どおりworkspace-manager.tsに一元化されたままで、このファイルはBoardId採番のみ担う。
// ポップアップ（ADR 0005）はBoardをまたいでも同じものを使えるよう、Board単位ではなくこの層で
// popup.tsのcreatePopupインスタンスを1つだけ保持する（ADR 0006）。
import type { CopyModeKey } from "./copy-mode";
import type { MouseEventInput } from "./ghostty";
import type { PersistedBoardStartup, RestoredTreeMeta } from "./persistence";
import { toPersistedTileNode, type PersistedTileNode } from "./persistence";
import {
  createBoard,
  type Board,
  type BoardId,
  type BoardOptions,
  type BoardRenderState,
  type GetTabVarResult,
} from "./board";
import { createPopup, type OpenPopupOptions, type Popup, type PopupRenderState } from "./popup";

export type { BoardId, BoardRenderState, TabRenderState } from "./board";
export type { OpenPopupOptions, PopupRenderState } from "./popup";
import {
  findNode,
  listLeaves,
  type SplitOrientation,
  type SplitPlacement,
  type TabId,
  type TileId,
} from "./tile-layout";

export type { GetTabVarResult } from "./board";

export type CloseBoardResult = { ok: true } | { ok: false; reason: "not-found" | "last-board" };

/**
 * ワークスペース間の移動中、どのWorkspaceにも属していないBoard（detachBoard→adoptBoardの受け渡し）。
 * Boardインスタンスが自分のPTYセッションを抱えたまま移るため、タブ単体の移動と違いセッションの
 * 移管は要らない
 */
export interface DetachedBoard {
  boardId: BoardId;
  board: Board;
  name?: string;
  startup?: PersistedBoardStartup;
  worktreePath?: string;
}

export interface WorkspaceRenderState {
  activeBoardId: BoardId;
  /** 表示順 */
  boardIds: BoardId[];
  /** アクティブなBoardの描画データのみ */
  board: BoardRenderState;
  /** サイドバー描画用。全Boardのレイアウト骨格（PTY内容は含まない、listBoards()と同一データ） */
  boards: BoardListEntry[];
  /**
   * Tile木構造・Boardとは独立したポップアップ画面（ADR 0005）。Boardをまたいでも同じものを使える
   * （ADR 0006）。中身のPTY描画状態はboard.tabsに同居させている（popupのtabIdをキーに引ける）ため、
   * ここではメタ情報のみ持つ。width/heightは表示サイズの指定（1〜100のパーセント）。
   * 未指定はCSS側の既定値（80%）に従う
   */
  popup: PopupRenderState | null;
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
  /** 一時的にズーム表示中のtileId（tmuxのresize-pane -Z相当）。ズームしていなければnull */
  zoomedTileId: TileId | null;
  /** 紐づくレイアウトプリセットと起動時の組み直し方。未設定はnull */
  startup: PersistedBoardStartup | null;
  /** 対応するgitワークツリーの絶対パス。worktreeコマンド由来でないBoardはnull */
  worktreePath: string | null;
}

/** newBoardの任意指定。cwdだけは呼び出し側で必須になりがちなので引数のまま分けている */
export interface NewBoardOptions {
  /** falseなら作るだけでアクティブにしない */
  activate?: boolean;
  /** このBoardが対応するgitワークツリーの絶対パス */
  worktreePath?: string;
}

export interface BoardLocation {
  boardId: BoardId;
  tileId: TileId;
}

export interface InitialBoard {
  /**
   * 復元するTileツリー。省略すると単一タイル・単一タブの新規Boardとして作る
   * （startup.restoreMode: "layout"のBoardが該当。骨格を復元せずプリセットで組み直すため、
   * 前回セッションのタブ名・vars・cwdを持ち込まない）
   */
  tree?: NonNullable<BoardOptions["initialTree"]>;
  name?: string;
  restoredMeta?: RestoredTreeMeta;
  startup?: PersistedBoardStartup;
  worktreePath?: string;
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
  onBell?: BoardOptions["onBell"];
  createSession?: BoardOptions["createSession"];
}

export function createWorkspace(opts: WorkspaceOptions) {
  const boards = new Map<BoardId, Board>();
  let order: BoardId[] = [];
  let activeBoardId: BoardId;
  // Board名。getPersistableBoards経由で永続化対象になる
  const boardNames = new Map<BoardId, string>();
  // Boardに紐づくレイアウトプリセットと起動時の組み直し方。boardNamesと同じく
  // getPersistableBoards経由で永続化対象になる
  const boardStartups = new Map<BoardId, PersistedBoardStartup>();
  // Boardが対応するgitワークツリーの絶対パス。boardNamesと同じく永続化対象になる
  const boardWorktreePaths = new Map<BoardId, string>();
  // ポップアップ（ADR 0005）。Boardをまたいでも同じものを使えるようWorkspace直下で1つだけ持つ（ADR 0006）
  const popup: Popup = createPopup({
    genTabId: opts.genTabId,
    getDefaultShell: opts.getDefaultShell,
    onDirty: () => opts.onDirty(),
    createSession: opts.createSession,
  });

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
      onBell: opts.onBell,
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
    boardStartups.delete(id);
    boardWorktreePaths.delete(id);
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
      // setBoardName/setBoardStartupは経由しない（onDirtyを呼ぶため。初期構築フェーズは
      // dirty通知しない既存方針）
      if (initialBoard.name !== undefined) boardNames.set(id, initialBoard.name);
      if (initialBoard.startup !== undefined) boardStartups.set(id, initialBoard.startup);
      if (initialBoard.worktreePath !== undefined)
        boardWorktreePaths.set(id, initialBoard.worktreePath);
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

  /** 画面に出ているタブ。アクティブでないBoardのタブは見えていないため含まない */
  function listVisibleTabIds(): TabId[] {
    return (boards.get(activeBoardId) as Board).listVisibleTabIds();
  }

  function clearBell(tabId: TabId): boolean {
    return findBoardOwnerByTabId(tabId)?.clearBell(tabId) ?? false;
  }

  /** ユーザーがサイドバーから設定したタブ名。未設定・不存在はnull */
  function getTabName(tabId: TabId): string | null {
    for (const board of boards.values()) {
      const name = board.listTabNames()[tabId];
      if (name !== undefined) return name;
    }
    return null;
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

  /** workspace-managerがboardIdの所属先Workspaceを判定するための軽量な参照 */
  function hasBoard(boardId: BoardId): boolean {
    return boards.has(boardId);
  }

  function getActiveBoardId(): BoardId {
    return activeBoardId;
  }

  /**
   * Boardを作る。activate=falseなら作るだけでアクティブにしない
   * （`worktree new --open board`のように、作業中のBoardを奪わず裏で用意する用途）
   */
  function newBoard(cwd?: string, options: NewBoardOptions = {}): BoardId {
    const boardId = createAndRegisterBoard(undefined, cwd);
    if (options.worktreePath !== undefined) boardWorktreePaths.set(boardId, options.worktreePath);
    if (options.activate !== false) activeBoardId = boardId;
    opts.onDirty();
    return boardId;
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
    boardStartups.delete(boardId);
    boardWorktreePaths.delete(boardId);
    order = order.filter((id) => id !== boardId);
    if (activeBoardId === boardId) {
      activeBoardId = order[order.length - 1];
    }
    opts.onDirty();
    return { ok: true };
  }

  /**
   * Boardを別ワークスペースへ移すために所有権だけ手放す（PTYは落とさない）。名前・起動時レイアウトの
   * 紐づけも一緒に持ち出し、移動先のadoptBoardがそのまま引き継ぐ。
   * 切り離した結果Boardが0個になってもここでは何もしない（そのWorkspaceごと畳むかどうかは
   * workspace-manager.tsの判断）。onDirtyも呼ばない: 移動の途中経過（Boardがどこにも属さない状態・
   * activeBoardIdが空を指す状態）で描画されないよう、移動が完了してから呼び出し側がまとめて促す
   */
  function detachBoard(boardId: BoardId): DetachedBoard | null {
    const board = boards.get(boardId);
    if (!board) return null;
    boards.delete(boardId);
    order = order.filter((id) => id !== boardId);
    const name = boardNames.get(boardId);
    const startup = boardStartups.get(boardId);
    const worktreePath = boardWorktreePaths.get(boardId);
    boardNames.delete(boardId);
    boardStartups.delete(boardId);
    boardWorktreePaths.delete(boardId);
    if (activeBoardId === boardId && order.length > 0) {
      activeBoardId = order[order.length - 1];
    }
    return {
      boardId,
      board,
      ...(name !== undefined ? { name } : {}),
      ...(startup !== undefined ? { startup } : {}),
      ...(worktreePath !== undefined ? { worktreePath } : {}),
    };
  }

  /**
   * detachBoardで切り離したBoardをこのWorkspaceへ迎え入れる。toIndexは0始まりの挿入位置で、
   * 省略・範囲外は末尾（サイドバーの並びで一番下）。アクティブBoardは変更しない
   * （移動しただけで表示中のBoardが切り替わるのは予期しづらいため）。
   * detachBoardと同じくonDirtyは呼ばない
   */
  function adoptBoard(detached: DetachedBoard, toIndex?: number): void {
    const { boardId, board } = detached;
    // 空になった通知の宛先を移動元のWorkspaceからこちらへ張り替える。張り替え忘れると
    // 移動先のboardsに死んだBoardが残り続ける
    board.setOnAllTabsClosed(() => handleBoardEmptied(boardId));
    boards.set(boardId, board);
    // 数値として不正な値（NaN）はspliceが0扱いにして先頭へ入れてしまうため、末尾へ寄せる
    const requested = Number.isFinite(toIndex) ? Math.trunc(toIndex as number) : order.length;
    order.splice(Math.min(Math.max(0, requested), order.length), 0, boardId);
    if (detached.name !== undefined) boardNames.set(boardId, detached.name);
    if (detached.startup !== undefined) boardStartups.set(boardId, detached.startup);
    if (detached.worktreePath !== undefined) boardWorktreePaths.set(boardId, detached.worktreePath);
  }

  /** detachBoardで最後のBoardを失ったかどうか。この状態のWorkspaceは描画に耐えないため即座に畳む */
  function isEmpty(): boolean {
    return boards.size === 0;
  }

  /**
   * ワークスペース内での表示順（サイドバーの並び・未設定時の連番ラベル）の並び替え。
   * orderの位置だけを動かし、各Boardの中身（レイアウト・タブ）とアクティブBoardは変更しない。
   * toIndexは0始まりで、範囲外はクランプする（端へのD&D・キーバインド連打が失敗扱いに
   * ならないようにするため）。falseを返すのはboardIdが無い・toIndexが数値として不正な場合のみ
   */
  function moveBoard(boardId: BoardId, toIndex: number): boolean {
    const fromIndex = order.indexOf(boardId);
    if (fromIndex === -1 || !Number.isFinite(toIndex)) return false;
    const clamped = Math.min(Math.max(0, Math.trunc(toIndex)), order.length - 1);
    if (clamped === fromIndex) return true;
    order.splice(fromIndex, 1);
    order.splice(clamped, 0, boardId);
    opts.onDirty();
    return true;
  }

  /** moveBoardの相対指定版。deltaは-1で1つ前へ、+1で1つ後ろへ（CLIの`board move --up/--down`向け） */
  function moveBoardBy(boardId: BoardId, delta: number): boolean {
    const fromIndex = order.indexOf(boardId);
    if (fromIndex === -1) return false;
    return moveBoard(boardId, fromIndex + delta);
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

  /** nullを渡すとプリセットの紐づけ自体を解除する（起動時は保存済みlayoutの復元に戻る） */
  function setBoardStartup(boardId: BoardId, startup: PersistedBoardStartup | null): boolean {
    if (!boards.has(boardId)) return false;
    if (startup === null) {
      boardStartups.delete(boardId);
    } else {
      boardStartups.set(boardId, startup);
    }
    opts.onDirty();
    return true;
  }

  function getBoardStartup(boardId: BoardId): PersistedBoardStartup | null {
    return boardStartups.get(boardId) ?? null;
  }

  /**
   * Boardのフォーカス中タイル・アクティブタブが報告しているcwd（未報告ならundefined）。
   * サイドバーからそのBoardを対象に操作したとき、プロジェクトローカル設定の解決起点に使う
   * （そのBoardのタブでCLIを叩いたのと同じ解決結果になる）
   */
  function getBoardFocusedCwd(boardId: BoardId): string | undefined {
    return boards.get(boardId)?.getFocusedTabSnapshot()?.cwd;
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

  // ポップアップはWorkspace直下の状態（ADR 0005・ADR 0006）。cwd・サイズの継承元は
  // 「現在アクティブなBoard」のフォーカス中タブとする（openPopup実行時点でのアクティブBoard）
  function openPopup(popupOpts: OpenPopupOptions = {}): TabId | null {
    const inherited = boards.get(activeBoardId)?.getFocusedTabSnapshot();
    return popup.open(popupOpts, inherited ?? { cols: opts.initialCols, rows: opts.initialRows });
  }

  function closePopup(): boolean {
    return popup.close();
  }

  /**
   * 開いているポップアップが閉じる（または昇格する）まで待つ。`popup open --wait`用。
   * 解決値はcaptureStdout指定時のキャプチャ結果（`popup open --wait --capture-stdout`用）
   */
  function waitForPopupClose(): Promise<string | undefined> {
    return popup.waitForClose();
  }

  function togglePopupVisibility(): boolean | null {
    return popup.toggleVisibility();
  }

  /**
   * 開いているポップアップの中身を、実行時点でアクティブなBoardのフォーカス中タイルへ
   * 通常タブとして編入する（タブへ昇格。ADR 0005）。PTYセッションは作り直さない
   */
  function promotePopup(): { tileId: TileId; tabId: TabId } | null {
    const promoted = popup.takeForPromotion();
    if (!promoted) return null;
    const board = boards.get(activeBoardId) as Board;
    const tileId = board.getFocusedTileId();
    const ok = board.adoptTab(promoted.tabId, promoted.session, {
      cols: promoted.cols,
      rows: promoted.rows,
      shell: promoted.shell,
      vars: promoted.vars,
    });
    if (!ok) {
      promoted.session.dispose();
      return null;
    }
    return { tileId, tabId: promoted.tabId };
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

  function cycleTab(tileId: TileId, delta: 1 | -1): boolean {
    return findBoardOwnerByTileId(tileId)?.cycleTab(tileId, delta) ?? false;
  }

  // ドラッグ&ドロップによるタブ移動。PTYセッションはBoardインスタンスのクロージャ内に閉じているため、
  // Boardをまたぐ移動はセッションの移管が必要になり非対応（無視してfalseを返す）
  function moveTab(fromTileId: TileId, tabId: TabId, toTileId: TileId): boolean {
    const owner = findBoardOwnerByTileId(fromTileId);
    if (!owner || owner !== findBoardOwnerByTileId(toTileId)) return false;
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
    const owner = findBoardOwnerByTileId(fromTileId);
    if (!owner || owner !== findBoardOwnerByTileId(targetTileId)) return false;
    return owner.moveTabToSplit(fromTileId, tabId, targetTileId, orientation, placement);
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
    if (popup.hasTab(tabId)) {
      popup.handleInput(data);
      return;
    }
    findBoardOwnerByTabId(tabId)?.handleInput(tabId, data);
  }

  /** board.tsのsendInitialInput参照。popupタブは対象外（レイアウト適用専用の経路のため） */
  function sendInitialInput(tabId: TabId, data: string): boolean {
    return findBoardOwnerByTabId(tabId)?.sendInitialInput(tabId, data) ?? false;
  }

  function handlePaste(tabId: TabId, data: string): void {
    if (popup.hasTab(tabId)) {
      popup.handlePaste(data);
      return;
    }
    findBoardOwnerByTabId(tabId)?.handlePaste(tabId, data);
  }

  function handleMouseEvent(tabId: TabId, ev: MouseEventInput): void {
    if (popup.hasTab(tabId)) {
      popup.handleMouseEvent(ev);
      return;
    }
    findBoardOwnerByTabId(tabId)?.handleMouseEvent(tabId, ev);
  }

  function enterCopyMode(tabId: TabId): void {
    if (popup.hasTab(tabId)) {
      popup.enterCopyMode();
      return;
    }
    findBoardOwnerByTabId(tabId)?.enterCopyMode(tabId);
  }

  function handleCopyModeKey(tabId: TabId, key: CopyModeKey): boolean {
    if (popup.hasTab(tabId)) return popup.handleCopyModeKey(key);
    return findBoardOwnerByTabId(tabId)?.handleCopyModeKey(tabId, key) ?? false;
  }

  function handleScroll(tabId: TabId, deltaLines: number): void {
    if (popup.hasTab(tabId)) {
      popup.handleScroll(deltaLines);
      return;
    }
    findBoardOwnerByTabId(tabId)?.handleScroll(tabId, deltaLines);
  }

  function handleScrollToTop(tabId: TabId): void {
    if (popup.hasTab(tabId)) {
      popup.handleScrollToTop();
      return;
    }
    findBoardOwnerByTabId(tabId)?.handleScrollToTop(tabId);
  }

  function handleScrollToBottom(tabId: TabId): void {
    if (popup.hasTab(tabId)) {
      popup.handleScrollToBottom();
      return;
    }
    findBoardOwnerByTabId(tabId)?.handleScrollToBottom(tabId);
  }

  function handleResize(
    tabId: TabId,
    cols: number,
    rows: number,
    cellWidthPx: number,
    cellHeightPx: number,
  ): void {
    if (popup.hasTab(tabId)) {
      popup.handleResize(cols, rows, cellWidthPx, cellHeightPx);
      return;
    }
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
        zoomedTileId: board.getZoomedTileId(),
        startup: boardStartups.get(id) ?? null,
        worktreePath: boardWorktreePaths.get(id) ?? null,
      };
    });
  }

  function hasTab(tabId: TabId): boolean {
    return popup.hasTab(tabId) || findBoardOwnerByTabId(tabId) !== undefined;
  }

  function getTabText(tabId: TabId): string | null {
    if (popup.hasTab(tabId)) return popup.getTabText();
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

  function collectTabsByVar(board: Board, key: string, value: string): TabId[] {
    const result: TabId[] = [];
    for (const leaf of listLeaves(board.getLayout())) {
      for (const tabId of leaf.tabIds) {
        const found = board.getTabVar(tabId, key);
        if (found.found && found.value === value) result.push(tabId);
      }
    }
    return result;
  }

  // niwa.tab.var.find向け。Workspace内の全Board・タイル・タブを横断して探す
  function findTabsByVar(key: string, value: string): TabId[] {
    const result: TabId[] = [];
    for (const board of boards.values()) {
      result.push(...collectTabsByVar(board, key, value));
    }
    return result;
  }

  // CLIの`tab var find`向け。指定Board内だけを探す。boardIdが存在しない場合はnull
  function findTabsByVarInBoard(boardId: BoardId, key: string, value: string): TabId[] | null {
    const board = boards.get(boardId);
    if (!board) return null;
    return collectTabsByVar(board, key, value);
  }

  function setTabName(tabId: TabId, name: string): boolean {
    return findBoardOwnerByTabId(tabId)?.setTabName(tabId, name) ?? false;
  }

  function setTileName(tileId: TileId, name: string): boolean {
    return findBoardOwnerByTileId(tileId)?.setTileName(tileId, name) ?? false;
  }

  function snapshot(): WorkspaceRenderState {
    const active = boards.get(activeBoardId) as Board;
    const activeBoardState = active.snapshot();
    const popupState = popup.snapshot();
    const popupRenderState = popupState ? popup.renderState() : null;
    // popupの中身（HTML等）はboard.tabsに同居させる。mainview側は既存のterminalタブ更新ループが
    // termElByTabId登録済みのtabIdをそのまま拾うため、この形にすると呼び出し側の変更が不要になる
    const board: BoardRenderState =
      popupState && popupRenderState
        ? {
            ...activeBoardState,
            tabs: { ...activeBoardState.tabs, [popupState.tabId]: popupRenderState },
          }
        : activeBoardState;
    return {
      activeBoardId,
      boardIds: [...order],
      board,
      boards: listBoards(),
      popup: popupState,
    };
  }

  /** 永続化用。全Boardのlayout・タブメタ・名前をそのまま返す（PersistedBoard[]への変換はpersistence.ts側で行う） */
  function getPersistableBoards(): {
    boardId: BoardId;
    layout: PersistedTileNode;
    name?: string;
    startup?: PersistedBoardStartup;
    worktreePath?: string;
  }[] {
    return order.map((id) => {
      const board = boards.get(id) as Board;
      const layout = toPersistedTileNode(board.getLayout(), {
        focusedTileId: board.getFocusedTileId(),
        tabs: board.getPersistableTabs(),
        tileNames: board.listTileNames(),
      });
      const name = boardNames.get(id);
      const startup = boardStartups.get(id);
      const worktreePath = boardWorktreePaths.get(id);
      const entry: {
        boardId: BoardId;
        layout: PersistedTileNode;
        name?: string;
        startup?: PersistedBoardStartup;
        worktreePath?: string;
      } = { boardId: id, layout };
      if (name !== undefined) entry.name = name;
      if (startup !== undefined) entry.startup = startup;
      if (worktreePath !== undefined) entry.worktreePath = worktreePath;
      return entry;
    });
  }

  function getActiveBoardIndex(): number {
    return order.indexOf(activeBoardId);
  }

  /** サイドバー一覧用の軽量な参照。非アクティブなWorkspaceでもポップアップの有無・表示状態を把握できるようにする */
  function getPopupInfo(): { tabId: TabId; visible: boolean } | null {
    return popup.getInfo();
  }

  function dispose(): void {
    for (const board of boards.values()) board.dispose();
    boards.clear();
    popup.dispose();
  }

  return {
    newBoard,
    switchBoard,
    closeBoard,
    detachBoard,
    adoptBoard,
    isEmpty,
    moveBoard,
    moveBoardBy,
    setBoardName,
    setBoardStartup,
    getBoardStartup,
    getBoardFocusedCwd,
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
    handleInput,
    sendInitialInput,
    handleMouseEvent,
    handlePaste,
    enterCopyMode,
    handleCopyModeKey,
    handleResize,
    handleScroll,
    handleScrollToTop,
    handleScrollToBottom,
    snapshot,
    listBoards,
    listVisibleTabIds,
    clearBell,
    getTabName,
    hasTab,
    hasTile,
    hasBoard,
    locateTab,
    locateBrowserTab,
    getActiveBoardId,
    getActiveBoardIndex,
    getTabText,
    getPopupInfo,
    setTabVar,
    getTabVar,
    listTabVars,
    findTabsByVar,
    findTabsByVarInBoard,
    setTabName,
    setTileName,
    getPersistableBoards,
    dispose,
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
