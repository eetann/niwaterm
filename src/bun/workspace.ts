// 複数のBoard（createBoardのインスタンス）を束ね、Boardの切り替え・作成・削除を管理する層（ADR 0006）。
// workspace-manager.tsが複数Workspaceを束ねるのと同じパターンを、Workspace内で複数Boardへ1段複製したもの。
// tile/tabのid採番は既存方針どおりworkspace-manager.tsに一元化されたままで、このファイルはBoardId採番のみ担う。
// ポップアップ（ADR 0005）はBoardをまたいでも同じものを使えるよう、Board単位ではなくこの層で
// popup.tsのcreatePopupインスタンスを1つだけ保持する（ADR 0006）。
import type { BoardNaming } from "@niwaterm/config";
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
import { directoryName, isSequentialName, nextSequentialName } from "./board-naming";
import type { PopupGeometry } from "../shared/popup-geometry";
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

export interface CloseBoardOptions {
  /**
   * 最後の1Boardでも閉じてよいか。Board 0個のWorkspaceを残せるかはウィンドウ全体の状況
   * （他にWorkspaceがあるか）で決まるため、判断はworkspace-manager.ts側が持つ
   */
  allowEmpty?: boolean;
}

/**
 * ワークスペース間の移動中、どのWorkspaceにも属していないBoard（detachBoard→adoptBoardの受け渡し）。
 * Boardインスタンスが自分のPTYセッションを抱えたまま移るため、タブ単体の移動と違いセッションの
 * 移管は要らない
 */
export interface DetachedBoard {
  boardId: BoardId;
  board: Board;
  name?: string;
  autoName?: string;
  startup?: PersistedBoardStartup;
  worktreePath?: string;
  phase?: string;
}

export interface WorkspaceRenderState {
  /** Boardが1つも無いWorkspaceではnull（mainview側は案内画面を出す） */
  activeBoardId: BoardId | null;
  /** 表示順 */
  boardIds: BoardId[];
  /** アクティブなBoardの描画データのみ。Boardが1つも無ければnull */
  board: BoardRenderState | null;
  /** サイドバー描画用。全Boardのレイアウト骨格（PTY内容は含まない、listBoards()と同一データ） */
  boards: BoardListEntry[];
  /**
   * Tile木構造・Boardとは独立したポップアップ画面（ADR 0005）。Boardをまたいでも同じものを使える
   * （ADR 0006）。中身のPTY描画状態はboard.tabsに同居させている（popupのtabIdをキーに引ける）ため、
   * ここではメタ情報のみ持つ。width/heightは表示サイズ、x/yは左上角の表示位置
   * （いずれもウィンドウに対する0〜100のパーセント）。未指定はCSS側の既定値
   * （中央・80%）に従う
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
  /** ユーザー・CLIが明示的に付けたBoard名。未設定はnull（表示側はautoNameへフォールバックする） */
  name: string | null;
  /** 名前を付けていないBoardへ設定（board.naming）が自動で付けた名前。付けられなければnull */
  autoName: string | null;
  /** 一時的にズーム表示中のtileId（tmuxのresize-pane -Z相当）。ズームしていなければnull */
  zoomedTileId: TileId | null;
  /** 紐づくレイアウトプリセットと起動時の組み直し方。未設定はnull */
  startup: PersistedBoardStartup | null;
  /** 対応するgitワークツリーの絶対パス。worktreeコマンド由来でないBoardはnull */
  worktreePath: string | null;
  /** ユーザーが付けた作業フェーズ。board.phasesのidか任意の文字列。未設定はnull */
  phase: string | null;
}

/** newBoardの任意指定。cwdだけは呼び出し側で必須になりがちなので引数のまま分けている */
export interface NewBoardOptions {
  /** falseなら作るだけでアクティブにしない */
  activate?: boolean;
  /** このBoardが対応するgitワークツリーの絶対パス */
  worktreePath?: string;
  /** Boardの表示名。空文字列・空白のみは未設定（設定board.namingによる自動名）として扱う */
  name?: string;
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
  autoName?: string;
  restoredMeta?: RestoredTreeMeta;
  startup?: PersistedBoardStartup;
  worktreePath?: string;
  phase?: string;
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
  /**
   * 最後の1Boardの最後のタブが閉じられた時に呼ばれる（Workspace自体が空になった）。
   * このWorkspaceを畳むか、Board 0個のまま残すかは呼び出し側の判断。残す場合の再描画要求も
   * 呼び出し側が出す（畳んだ後にこちらからonDirtyを呼ぶと、破棄済みのWorkspaceを描画しにいく）
   */
  onAllTabsClosed: () => void;
  getDefaultShell?: BoardOptions["getDefaultShell"];
  getDefaultCwd?: BoardOptions["getDefaultCwd"];
  /**
   * 新しいタブ（タブ追加・タイル分割・ポップアップ）のcwdを、そのBoardの紐づけワークツリーから決める。
   * 戻り値undefinedなら従来どおり今のタブのcwdを引き継ぐ。設定（board.newTabCwd）と
   * ディレクトリの存在確認はここを渡す側（index.ts）の責務
   */
  getNewTabCwd?: (worktreePath: string | undefined) => string | undefined;
  /** 名前を付けていないBoardの自動命名の方式（設定のboard.naming）。省略時は"directory" */
  getBoardNaming?: () => BoardNaming;
  getMaxScrollback?: BoardOptions["getMaxScrollback"];
  onBell?: BoardOptions["onBell"];
  createSession?: BoardOptions["createSession"];
}

export function createWorkspace(opts: WorkspaceOptions) {
  const boards = new Map<BoardId, Board>();
  let order: BoardId[] = [];
  // Boardが1つも無い間はnull。Board 0個のWorkspaceは「レビュー中のワークツリー用」のように
  // 中身が一時的に空になる置き場として残す
  let activeBoardId: BoardId | null;
  // ユーザー・CLIが明示的に付けたBoard名。getPersistableBoards経由で永続化対象になる
  const boardNames = new Map<BoardId, string>();
  // 名前を付けていないBoardへ自動で付いた名前。boardNamesと同じく永続化対象になる。
  // 表示順（order）から毎回導くのではなく1つずつ持つのは、並び替えても名前が動かないようにするため
  const boardAutoNames = new Map<BoardId, string>();
  // Boardに紐づくレイアウトプリセットと起動時の組み直し方。boardNamesと同じく
  // getPersistableBoards経由で永続化対象になる
  const boardStartups = new Map<BoardId, PersistedBoardStartup>();
  // Boardが対応するgitワークツリーの絶対パス。boardNamesと同じく永続化対象になる
  const boardWorktreePaths = new Map<BoardId, string>();
  // ユーザーが付けた作業フェーズ。boardNamesと同じく永続化対象になる
  const boardPhases = new Map<BoardId, string>();
  // ポップアップ（ADR 0005）。Boardをまたいでも同じものを使えるようWorkspace直下で1つだけ持つ（ADR 0006）
  const popup: Popup = createPopup({
    genTabId: opts.genTabId,
    getDefaultShell: opts.getDefaultShell,
    getMaxScrollback: opts.getMaxScrollback,
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
      onDirty: () => {
        refreshAutoNameFromCwd(id);
        opts.onDirty();
      },
      onAllTabsClosed: () => handleBoardEmptied(id),
      getDefaultShell: opts.getDefaultShell,
      getDefaultCwd: opts.getDefaultCwd,
      getNewTabCwd: () => newTabCwdOf(id),
      getMaxScrollback: opts.getMaxScrollback,
      onBell: opts.onBell,
      createSession: opts.createSession,
    });
    boards.set(id, board);
    order.push(id);
    return id;
  }

  function forgetBoardMeta(id: BoardId): void {
    boardNames.delete(id);
    boardAutoNames.delete(id);
    boardStartups.delete(id);
    boardWorktreePaths.delete(id);
    boardPhases.delete(id);
  }

  /**
   * Board 0個になった後始末。ポップアップの描画データはアクティブBoardのtabsに相乗りしているため、
   * Boardが無い間は開いていても画面に出せない。開きっぱなしのPTYが見えない所に残らないよう閉じる
   */
  function handleWorkspaceBecameEmpty(): void {
    activeBoardId = null;
    popup.close();
  }

  // あるBoardの最後のタイル・最後のタブが閉じられた時の挙動。
  // そのBoard自体を削除し、他のBoardへ切り替える。最後の1つだった場合のみWorkspace自体を空とみなす。
  function handleBoardEmptied(id: BoardId): void {
    boards.get(id)?.dispose();
    boards.delete(id);
    forgetBoardMeta(id);
    order = order.filter((bid) => bid !== id);
    if (order.length === 0) {
      handleWorkspaceBecameEmpty();
      // 畳むか空のまま残すかは呼び出し側の判断。onDirtyもそちらに任せる
      opts.onAllTabsClosed();
      return;
    }
    if (activeBoardId === id) {
      activeBoardId = order[order.length - 1];
    }
    opts.onDirty();
  }

  // 空配列は「Boardが0個のWorkspaceを復元する」指定。省略（undefined）とは意味が違う
  if (opts.initialBoards) {
    for (const initialBoard of opts.initialBoards) {
      const id = createAndRegisterBoard(initialBoard.tree, undefined, initialBoard.restoredMeta);
      // setBoardName/setBoardStartupは経由しない（onDirtyを呼ぶため。初期構築フェーズは
      // dirty通知しない既存方針）
      if (initialBoard.name !== undefined) boardNames.set(id, initialBoard.name);
      else if (initialBoard.autoName !== undefined) boardAutoNames.set(id, initialBoard.autoName);
      else assignAutoName(id);
      if (initialBoard.startup !== undefined) boardStartups.set(id, initialBoard.startup);
      if (initialBoard.worktreePath !== undefined)
        boardWorktreePaths.set(id, initialBoard.worktreePath);
      if (initialBoard.phase !== undefined) boardPhases.set(id, initialBoard.phase);
    }
    const clampedIndex = Math.min(Math.max(0, opts.activeBoardIndex ?? 0), order.length - 1);
    activeBoardId = order.length === 0 ? null : order[clampedIndex];
  } else {
    activeBoardId = createAndRegisterBoard(undefined, opts.initialCwd);
    assignAutoName(activeBoardId, opts.initialCwd);
  }

  function findBoardOwnerByTileId(tileId: TileId): Board | undefined {
    for (const board of boards.values()) {
      if (findNode(board.getLayout(), tileId)) return board;
    }
    return undefined;
  }

  /** アクティブなBoard。Boardが1つも無ければundefined */
  function activeBoard(): Board | undefined {
    return activeBoardId === null ? undefined : boards.get(activeBoardId);
  }

  /** 画面に出ているタブ。アクティブでないBoardのタブは見えていないため含まない */
  function listVisibleTabIds(): TabId[] {
    return activeBoard()?.listVisibleTabIds() ?? [];
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

  /** Boardが1つも無いWorkspaceではnull */
  function getActiveBoardId(): BoardId | null {
    return activeBoardId;
  }

  /**
   * Boardを作る。activate=falseなら作るだけでアクティブにしない
   * （`worktree new --open board`のように、作業中のBoardを奪わず裏で用意する用途）
   */
  function newBoard(cwd?: string, options: NewBoardOptions = {}): BoardId {
    const boardId = createAndRegisterBoard(undefined, cwd);
    if (options.worktreePath !== undefined) boardWorktreePaths.set(boardId, options.worktreePath);
    if (options.name !== undefined && options.name.trim() !== "")
      boardNames.set(boardId, options.name);
    assignAutoName(boardId, cwd);
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

  function closeBoard(boardId: BoardId, options: CloseBoardOptions = {}): CloseBoardResult {
    if (!boards.has(boardId)) return { ok: false, reason: "not-found" };
    // 最後の1つを閉じるとWorkspaceがBoard 0個になる。それを許すかは呼び出し側の判断
    if (boards.size === 1 && options.allowEmpty !== true)
      return { ok: false, reason: "last-board" };
    boards.get(boardId)?.dispose();
    boards.delete(boardId);
    forgetBoardMeta(boardId);
    order = order.filter((id) => id !== boardId);
    if (order.length === 0) {
      handleWorkspaceBecameEmpty();
    } else if (activeBoardId === boardId) {
      activeBoardId = order[order.length - 1];
    }
    opts.onDirty();
    return { ok: true };
  }

  /**
   * Boardを別ワークスペースへ移すために所有権だけ手放す（PTYは落とさない）。名前・起動時レイアウトの
   * 紐づけも一緒に持ち出し、移動先のadoptBoardがそのまま引き継ぐ。
   * 切り離した結果Board 0個になったWorkspaceを畳むかどうかはworkspace-manager.tsの判断。
   * onDirtyは呼ばない: 移動の途中経過（Boardがどこにも属さない状態）で描画されないよう、
   * 移動が完了してから呼び出し側がまとめて促す
   */
  function detachBoard(boardId: BoardId): DetachedBoard | null {
    const board = boards.get(boardId);
    if (!board) return null;
    boards.delete(boardId);
    order = order.filter((id) => id !== boardId);
    const name = boardNames.get(boardId);
    const autoName = boardAutoNames.get(boardId);
    const startup = boardStartups.get(boardId);
    const worktreePath = boardWorktreePaths.get(boardId);
    const phase = boardPhases.get(boardId);
    forgetBoardMeta(boardId);
    if (order.length === 0) {
      // ポップアップを閉じる分のonDirtyだけは出る（開いていた場合のみ）
      handleWorkspaceBecameEmpty();
    } else if (activeBoardId === boardId) {
      activeBoardId = order[order.length - 1];
    }
    return {
      boardId,
      board,
      ...(name !== undefined ? { name } : {}),
      ...(autoName !== undefined ? { autoName } : {}),
      ...(startup !== undefined ? { startup } : {}),
      ...(worktreePath !== undefined ? { worktreePath } : {}),
      ...(phase !== undefined ? { phase } : {}),
    };
  }

  /**
   * detachBoardで切り離したBoardをこのWorkspaceへ迎え入れる。toIndexは0始まりの挿入位置で、
   * 省略・範囲外は末尾（サイドバーの並びで一番下）。アクティブBoardは変更しない
   * （移動しただけで表示中のBoardが切り替わるのは予期しづらいため。Board 0個だった場合のみ、
   * 迎えたBoardをアクティブにする）。
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
    adoptAutoName(boardId, detached.autoName);
    if (detached.startup !== undefined) boardStartups.set(boardId, detached.startup);
    if (detached.worktreePath !== undefined) boardWorktreePaths.set(boardId, detached.worktreePath);
    if (detached.phase !== undefined) boardPhases.set(boardId, detached.phase);
    if (activeBoardId === null) activeBoardId = boardId;
  }

  /** Boardを1つも持っていないか（空のまま残すか畳むかの判断はworkspace-manager.ts側） */
  function isEmpty(): boolean {
    return boards.size === 0;
  }

  /**
   * ワークスペース内での表示順（サイドバーの並び）の並び替え。
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

  function namingMode(): BoardNaming {
    return opts.getBoardNaming?.() ?? "directory";
  }

  /**
   * 明示的な名前（ユーザー・CLIが付けた名前）があるBoardか。この間は自動名を持たせない。
   * 表示されないうえ、連番方式では見えない番号を消費してサイドバーの並びが飛び飛びに見えるため
   */
  function hasExplicitName(boardId: BoardId): boolean {
    return boardNames.has(boardId);
  }

  /**
   * 名前を付けていないBoardに出す自動名を、今の方式で決める。連番は既に振ってあれば振り直さない
   * （閉じた・移動したBoardの都合で他のBoardの番号が動くと、番号で覚えている意味が無くなるため）。
   * ディレクトリ名はcwdが分からなければ付けない（追従方式ならタブがcwdを報告した時点で付く）
   */
  function assignAutoName(boardId: BoardId, cwd?: string): void {
    if (hasExplicitName(boardId)) return;
    if (namingMode() === "sequential") {
      const current = boardAutoNames.get(boardId);
      if (current !== undefined && isSequentialName(current)) return;
      boardAutoNames.set(boardId, nextSequentialName(boardAutoNames.values()));
      return;
    }
    const name = directoryName(cwd ?? getBoardFocusedCwd(boardId) ?? opts.getDefaultCwd?.());
    if (name !== null) boardAutoNames.set(boardId, name);
  }

  /**
   * 別ワークスペースから移ってきたBoardの自動名を引き継ぐ。連番は移動先で既に使われていることが
   * あるので、その場合だけ空き番号へ振り直す
   */
  function adoptAutoName(boardId: BoardId, autoName: string | undefined): void {
    if (hasExplicitName(boardId)) return;
    if (autoName === undefined) {
      assignAutoName(boardId);
      return;
    }
    const taken = isSequentialName(autoName) && [...boardAutoNames.values()].includes(autoName);
    boardAutoNames.set(boardId, taken ? nextSequentialName(boardAutoNames.values()) : autoName);
  }

  /**
   * タブが報告しているcwdから自動名を決め直す。Boardの描画更新のたびに通る。
   * 追従方式（board.naming: "directory-follow"）は毎回付け替えるので、cdだけでなくタイル移動・
   * タブ切り替えでも名前が変わる。"directory"はまだ名前が付いていない間だけ拾って以後は固定する
   * （cwdを指定せずに開いたBoardが実際どこで起動したかは、シェルがOSC 7で報告するまで分からない）。
   * cwdを報告しないシェル（OSC 7未対応）のタブでは付いている名前をそのまま残す
   */
  function refreshAutoNameFromCwd(boardId: BoardId): void {
    if (hasExplicitName(boardId)) return;
    const mode = namingMode();
    if (mode === "sequential" || (mode === "directory" && boardAutoNames.has(boardId))) return;
    const name = directoryName(getBoardFocusedCwd(boardId));
    if (name !== null) boardAutoNames.set(boardId, name);
  }

  /**
   * 設定（board.naming）の切り替えを既にあるBoardへ反映する（設定ファイルのホットリロード用）。
   * ユーザー・CLIが付けた名前は方式によらず優先されるので触らない
   */
  function refreshBoardAutoNames(): void {
    for (const boardId of order) {
      if (hasExplicitName(boardId)) boardAutoNames.delete(boardId);
      else assignAutoName(boardId);
    }
    opts.onDirty();
  }

  /** 空文字列（trim後）を渡すと設定（board.naming）による自動名へ戻す */
  function setBoardName(boardId: BoardId, name: string): boolean {
    if (!boards.has(boardId)) return false;
    if (name.trim() === "") {
      boardNames.delete(boardId);
      // 自動名を付け直す。"directory"方式でもBoardを開いた時点のcwdはもう分からないので、
      // 今フォーカスしているタブのcwdを基準にする
      assignAutoName(boardId);
    } else {
      boardNames.set(boardId, name);
      boardAutoNames.delete(boardId);
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

  /** nullを渡すとワークツリーの紐づけを解除する */
  function setBoardWorktreePath(boardId: BoardId, worktreePath: string | null): boolean {
    if (!boards.has(boardId)) return false;
    if (worktreePath === null) {
      boardWorktreePaths.delete(boardId);
    } else {
      boardWorktreePaths.set(boardId, worktreePath);
    }
    opts.onDirty();
    return true;
  }

  function getBoardWorktreePath(boardId: BoardId): string | null {
    return boardWorktreePaths.get(boardId) ?? null;
  }

  /** nullまたは空文字列（trim後）を渡すとステータスを解除する */
  function setBoardPhase(boardId: BoardId, phase: string | null): boolean {
    if (!boards.has(boardId)) return false;
    if (phase === null || phase.trim() === "") {
      boardPhases.delete(boardId);
    } else {
      boardPhases.set(boardId, phase.trim());
    }
    opts.onDirty();
    return true;
  }

  function getBoardPhase(boardId: BoardId): string | null {
    return boardPhases.get(boardId) ?? null;
  }

  /** そのBoardで新しいタブを開くときのcwd。undefinedなら呼び出し側の既定（cwdの引き継ぎ）に任せる */
  function newTabCwdOf(boardId: BoardId): string | undefined {
    return opts.getNewTabCwd?.(boardWorktreePaths.get(boardId));
  }

  /**
   * Boardのフォーカス中タイル・アクティブタブが報告しているcwd（未報告ならundefined）。
   * サイドバーからそのBoardを対象に操作したとき、プロジェクトローカル設定の解決起点に使う
   * （そのBoardのタブでCLIを叩いたのと同じ解決結果になる）
   */
  function getBoardFocusedCwd(boardId: BoardId): string | undefined {
    return boards.get(boardId)?.getFocusedTabSnapshot()?.cwd;
  }

  /** getBoardFocusedCwdと同じタブの起動シェルコマンド。WSLタブのパス変換の判定に使う */
  function getBoardFocusedShell(boardId: BoardId): string | undefined {
    return boards.get(boardId)?.getFocusedTabShell();
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
    // ポップアップの描画データはアクティブBoardのtabsに相乗りしているため、Boardが無い間は開けない
    if (activeBoardId === null) return null;
    const inherited = activeBoard()?.getFocusedTabSnapshot();
    const base = inherited ?? { cols: opts.initialCols, rows: opts.initialRows };
    // cwdの上書きはここで行う。getFocusedTabSnapshotはタブが実際に報告したcwdの参照元でもあり
    // （getBoardFocusedCwd）、そちらまで紐づけへ寄せると解決起点が実態からずれる
    const boardCwd = newTabCwdOf(activeBoardId);
    return popup.open(popupOpts, boardCwd !== undefined ? { ...base, cwd: boardCwd } : base);
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

  function setPopupGeometry(g: PopupGeometry): boolean {
    return popup.setGeometry(g);
  }

  /**
   * 開いているポップアップの中身を、実行時点でアクティブなBoardのフォーカス中タイルへ
   * 通常タブとして編入する（タブへ昇格。ADR 0005）。PTYセッションは作り直さない
   */
  function promotePopup(): { tileId: TileId; tabId: TabId } | null {
    const board = activeBoard();
    if (!board) return null;
    const promoted = popup.takeForPromotion();
    if (!promoted) return null;
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
    activeBoard()?.focusDirection(direction);
  }

  /** Boardが1つも無いWorkspaceではnull */
  function getFocusedTileId(): TileId | null {
    return activeBoard()?.getFocusedTileId() ?? null;
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

  /** board.tsのsendInitialCommand参照。popupタブは対象外（レイアウト適用専用の経路のため） */
  function sendInitialCommand(tabId: TabId, command: string): boolean {
    return findBoardOwnerByTabId(tabId)?.sendInitialCommand(tabId, command) ?? false;
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

  function handleJumpPrompt(tabId: TabId, direction: "up" | "down"): void {
    if (popup.hasTab(tabId)) {
      popup.handleJumpPrompt(direction);
      return;
    }
    findBoardOwnerByTabId(tabId)?.handleJumpPrompt(tabId, direction);
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
        autoName: boardAutoNames.get(id) ?? null,
        zoomedTileId: board.getZoomedTileId(),
        startup: boardStartups.get(id) ?? null,
        worktreePath: boardWorktreePaths.get(id) ?? null,
        phase: boardPhases.get(id) ?? null,
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

  function clearTabVars(tabId: TabId): boolean {
    return findBoardOwnerByTabId(tabId)?.clearTabVars(tabId) ?? false;
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
    const active = activeBoard();
    if (!active) {
      return {
        activeBoardId: null,
        boardIds: [...order],
        board: null,
        boards: listBoards(),
        popup: null,
      };
    }
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
    autoName?: string;
    startup?: PersistedBoardStartup;
    worktreePath?: string;
    phase?: string;
  }[] {
    return order.map((id) => {
      const board = boards.get(id) as Board;
      const layout = toPersistedTileNode(board.getLayout(), {
        focusedTileId: board.getFocusedTileId(),
        tabs: board.getPersistableTabs(),
        tileNames: board.listTileNames(),
      });
      const name = boardNames.get(id);
      const autoName = boardAutoNames.get(id);
      const startup = boardStartups.get(id);
      const worktreePath = boardWorktreePaths.get(id);
      const phase = boardPhases.get(id);
      const entry: {
        boardId: BoardId;
        layout: PersistedTileNode;
        name?: string;
        autoName?: string;
        startup?: PersistedBoardStartup;
        worktreePath?: string;
        phase?: string;
      } = { boardId: id, layout };
      if (name !== undefined) entry.name = name;
      if (autoName !== undefined) entry.autoName = autoName;
      if (startup !== undefined) entry.startup = startup;
      if (worktreePath !== undefined) entry.worktreePath = worktreePath;
      if (phase !== undefined) entry.phase = phase;
      return entry;
    });
  }

  /** Boardが1つも無いWorkspaceでは-1（永続化では復元時にクランプされる） */
  function getActiveBoardIndex(): number {
    return activeBoardId === null ? -1 : order.indexOf(activeBoardId);
  }

  /** サイドバー一覧用の軽量な参照。非アクティブなWorkspaceでもポップアップの有無・表示状態を把握できるようにする */
  function getPopupInfo(): { tabId: TabId; visible: boolean } | null {
    return popup.getInfo();
  }

  /** 配下の全Board・ポップアップのスクロールバック保持行数を差し替える（設定ファイルのホットリロード用） */
  function applyMaxScrollback(lines: number): void {
    for (const board of boards.values()) board.applyMaxScrollback(lines);
    popup.applyMaxScrollback(lines);
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
    refreshBoardAutoNames,
    setBoardStartup,
    getBoardStartup,
    setBoardWorktreePath,
    getBoardWorktreePath,
    setBoardPhase,
    getBoardPhase,
    getBoardFocusedShell,
    getBoardFocusedCwd,
    splitTile,
    newTab,
    newBrowserTab,
    setBrowserTabUrl,
    openPopup,
    closePopup,
    waitForPopupClose,
    togglePopupVisibility,
    setPopupGeometry,
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
    sendInitialCommand,
    handleMouseEvent,
    handlePaste,
    enterCopyMode,
    handleCopyModeKey,
    handleResize,
    handleScroll,
    handleScrollToTop,
    handleScrollToBottom,
    handleJumpPrompt,
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
    clearTabVars,
    getTabVar,
    listTabVars,
    findTabsByVar,
    findTabsByVarInBoard,
    setTabName,
    setTileName,
    getPersistableBoards,
    applyMaxScrollback,
    dispose,
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
