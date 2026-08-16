// tile-layout.ts（純粋な木構造）と TerminalSession（I/O）を束ねる、状態を持つ層。
// bun/index.tsはこのモジュールだけを通してタイル・タブ・PTYを操作する。
import type { BrowserRenderState, BrowserTabState } from "./browser-tab";
import type {
  PersistedBrowserTab,
  PersistedTab,
  PersistedTerminalTab,
  RestoredTreeMeta,
} from "./persistence";
import {
  addTabToTile,
  closeTabInTile,
  findNode,
  focusNeighbor,
  listLeaves,
  moveTabToTile,
  resizeInDirection,
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
import { resolveActualCwd } from "./wsl-cwd";

export type TabRenderState = TerminalRenderState | BrowserRenderState;

export interface WorkspaceRenderState {
  layout: TileNode;
  focusedTileId: TileId;
  tabs: Record<TabId, TabRenderState>;
  /** ユーザーがサイドバーから設定したタブ名。未設定のタブは含まれない（表示側で連番にフォールバック） */
  tabNames: Record<TabId, string>;
  /** ユーザーがサイドバーから設定したタイル名。未設定のタイルは含まれない（表示側で連番にフォールバック） */
  tileNames: Record<TileId, string>;
  /**
   * ワークスペースごとに最大1つ持てる、Tile木構造とは独立したポップアップ画面（ADR 0005）。
   * 中身のPTY描画状態はtabsに同居させている（popupのtabIdをキーに引ける）ため、ここではメタ情報のみ持つ。
   * width/heightは表示サイズの指定（1〜100のパーセント）。未指定はCSS側の既定値（80%）に従う
   */
  popup: { tabId: TabId; visible: boolean; width?: number; height?: number } | null;
}

export interface OpenPopupOptions {
  /** 省略時はフォーカス中タイルのアクティブタブのcwdを引き継ぐ（split-tile/newTabと同じ方針） */
  cwd?: string;
  /** 指定すると、このコマンドをシェルの代わりに実行する（ワンショット実行）。終了すると自動的にポップアップも閉じる */
  command?: string;
  /** 表示サイズ（1〜100のパーセント）。省略時はCSS側の既定値に従う */
  width?: number;
  height?: number;
}

export type GetTabVarResult =
  | { found: true; value: string }
  | { found: false; reason: "tab-not-found" | "not-set" };

export type WorkspaceOptions = {
  initialCols: number;
  initialRows: number;
  /** tile/tabのid採番。複数Workspaceインスタンス間でのid衝突を避けるため外部（workspace-manager.ts）から注入する */
  genTileId: () => TileId;
  genTabId: () => TabId;
  /** 永続化からの復元時に渡す既存の木構造（tileId/tabIdは採番済み）。省略時は単一leaf・単一タブで新規作成する */
  initialTree?: TileNode;
  /** initialTree指定時のみ意味を持つ。永続化から復元したタブごとのメタ情報・タイル名・フォーカス先leaf。省略時は各タブをterminal・メタ情報なしとして復元する */
  restoredMeta?: RestoredTreeMeta;
  /**
   * 新規作成時（initialTree省略時）の最初のタブに使うcwd。省略時はgetDefaultCwd()（config指定値）、
   * それも省略時はpty.ts側のOS標準（homedir）を使う
   */
  initialCwd?: string;
  /** 描画すべき変化が生じた時に呼ばれる。描画スケジューリングは呼び出し側の責務 */
  onDirty: () => void;
  /** 最後の1タブのプロセスが終了した時に呼ばれる。アプリを終了するかどうかの判断は呼び出し側の責務 */
  onAllTabsClosed: () => void;
  /**
   * 新規タブ作成時に使うデフォルトシェルを取得する。省略時はpty.ts側のOS標準シェルを使う。
   * 呼び出し毎に評価する（設定ファイルのホットリロードを反映するため、生成時に値を固定しない）
   */
  getDefaultShell?: () => string | undefined;
  /**
   * 新規ワークスペース作成時（initialTree省略時）の最初のタブに使うデフォルトcwdを取得する。
   * 省略時・戻り値undefinedはpty.ts側のOS標準ホームディレクトリを使う。
   * getDefaultShellと同様、呼び出し毎に評価する（設定ファイルのホットリロードを反映するため）
   */
  getDefaultCwd?: () => string | undefined;
  /** テスト時にfakeへ差し替えるためのDI */
  createSession?: typeof createTerminalSession;
};

export function createWorkspace(opts: WorkspaceOptions) {
  const createSession = opts.createSession ?? createTerminalSession;
  const sessions = new Map<TabId, TerminalSession>();
  const browserTabs = new Map<TabId, BrowserTabState>();
  const sizeByTabId = new Map<TabId, { cols: number; rows: number }>();
  // 実際に使われた起動シェルコマンド（例: "wsl.exe -d NixOS"）。OSC7報告のcwdをWindows側から
  // アクセス可能な形式へ変換する要否判定（wsl-cwd.ts）に使う
  const shellByTabId = new Map<TabId, string | undefined>();
  const tabVars = new Map<TabId, Map<string, string>>();
  // タブ・タイル名。getPersistableTabs/listTileNames経由で永続化対象になる
  const tabNames = new Map<TabId, string>();
  const tileNames = new Map<TileId, string>();
  // ポップアップ用のTerminalSessionはsessionsマップに同居させる（input/resize等の既存tabId経路を
  // そのまま再利用するため）。popupTabIdで「Tile木構造に属さない特別なタブ」として区別する
  let popupTabId: TabId | null = null;
  let popupVisible = false;
  let popupWidth: number | undefined;
  let popupHeight: number | undefined;

  const genTileId = opts.genTileId;
  const genTabId = opts.genTabId;

  function spawnSession(
    tabId: TabId,
    cols: number,
    rows: number,
    shellOverride?: string,
    cwd?: string,
    command?: string,
  ): void {
    sizeByTabId.set(tabId, { cols, rows });
    const shell = shellOverride ?? opts.getDefaultShell?.();
    shellByTabId.set(tabId, shell);
    const session = createSession({
      cols,
      rows,
      shell,
      cwd,
      command,
      // シェル統合スクリプトやタブ内のCLI呼び出しが`--tab`省略でこのタブを指せるようにする
      env: { NIWATERM_TAB_ID: tabId },
      onOutput: () => opts.onDirty(),
      onExit: () => handleTabProcessExit(tabId),
      // OSC 7等で報告された実際のcwdをtabVarsへ反映する（split-tile/newTabのcwd省略時デフォルトにも使う）
      onPwdChanged: (cwd) => setTabVar(tabId, "cwd", cwd),
    });
    sessions.set(tabId, session);
  }

  /**
   * 永続化からの復元専用。初期構築フェーズ（createWorkspace呼び出し中）はonDirtyを呼ばない既存方針を
   * 踏襲するため、setTabVar/setTabName等の公開セッターは経由せずtabVars/tabNames/browserTabsへ直接書き込む
   */
  function restoreTab(
    tabId: TabId,
    cols: number,
    rows: number,
    meta: PersistedTab | undefined,
  ): void {
    if (meta?.name !== undefined) tabNames.set(tabId, meta.name);
    if (meta?.vars) {
      const entries = Object.entries(meta.vars);
      if (entries.length > 0) tabVars.set(tabId, new Map(entries));
    }
    if (meta?.kind === "browser") {
      browserTabs.set(tabId, { url: meta.url });
      return;
    }
    const shell = meta?.kind === "terminal" ? meta.shell : undefined;
    // vars.cwdはOSC7報告の生値（WSL変換前）。actualCwdOfと同じ変換を復元時にも適用する
    const rawCwd = meta?.vars?.["cwd"];
    const cwd = rawCwd !== undefined ? resolveActualCwd(rawCwd, shell) : opts.getDefaultCwd?.();
    spawnSession(tabId, cols, rows, shell, cwd);
  }

  let tree: TileNode;
  let focusedTileId: TileId;
  if (opts.initialTree) {
    tree = opts.initialTree;
    const leaves = listLeaves(tree);
    const meta = opts.restoredMeta;
    const requestedFocus = meta?.focusedTileId;
    focusedTileId =
      requestedFocus && findNode(tree, requestedFocus) ? requestedFocus : leaves[0].id;
    for (const leaf of leaves) {
      const tileName = meta?.tileNames.get(leaf.id);
      if (tileName !== undefined) tileNames.set(leaf.id, tileName);
      for (const tabId of leaf.tabIds) {
        restoreTab(tabId, opts.initialCols, opts.initialRows, meta?.tabMeta.get(tabId));
      }
    }
  } else {
    const firstTabId = genTabId();
    const firstTileId = genTileId();
    tree = { kind: "leaf", id: firstTileId, tabIds: [firstTabId], activeTabId: firstTabId };
    focusedTileId = firstTileId;
    spawnSession(
      firstTabId,
      opts.initialCols,
      opts.initialRows,
      undefined,
      opts.initialCwd ?? opts.getDefaultCwd?.(),
    );
  }

  function disposeSessions(tabIds: TabId[]): void {
    for (const tabId of tabIds) {
      sessions.get(tabId)?.dispose();
      sessions.delete(tabId);
      sizeByTabId.delete(tabId);
      shellByTabId.delete(tabId);
      browserTabs.delete(tabId);
    }
  }

  function applyCloseResult(newTree: TileNode, closedTabIds: TabId[], closedTileId?: TileId): void {
    tree = newTree;
    disposeSessions(closedTabIds);
    for (const tabId of closedTabIds) {
      tabVars.delete(tabId);
      tabNames.delete(tabId);
    }
    if (closedTileId) tileNames.delete(closedTileId);
    if (!findNode(tree, focusedTileId)) {
      focusedTileId = listLeaves(tree)[0]?.id ?? focusedTileId;
    }
    opts.onDirty();
  }

  // シェルが1つ終了した時の挙動。そのタブだけ閉じる（同じタイルに他のタブが残っていればタイルは維持）。
  // タイル内最後のタブで、かつワークスペース最後の1枚だった場合のみ「アプリごと終了」を維持する。
  function handleTabProcessExit(tabId: TabId): void {
    if (tabId === popupTabId) {
      disposeSessions([tabId]);
      popupTabId = null;
      popupVisible = false;
      popupWidth = undefined;
      popupHeight = undefined;
      opts.onDirty();
      return;
    }
    const leaf = listLeaves(tree).find((l) => l.tabIds.includes(tabId));
    if (!leaf) return;
    const result = closeTabInTile(tree, leaf.id, tabId);
    if (!result) return;
    if (result.tree === null) {
      disposeSessions([tabId]);
      tabNames.delete(tabId);
      opts.onAllTabsClosed();
      return;
    }
    applyCloseResult(result.tree, [tabId], result.tileClosed ? leaf.id : undefined);
  }

  /**
   * OSC 7等でタブが実際に報告してきたcwd（tabVarsの"cwd"）。未報告ならundefined。
   * WSLプロファイルのタブはWindows側のBun.spawnが解釈できるUNC形式へ変換する（wsl-cwd.ts）
   */
  function actualCwdOf(tabId: TabId): string | undefined {
    const raw = tabVars.get(tabId)?.get("cwd");
    if (raw === undefined) return undefined;
    return resolveActualCwd(raw, shellByTabId.get(tabId));
  }

  function splitTileById(
    tileId: TileId,
    orientation: SplitOrientation,
    ratio?: number,
    cwd?: string,
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
      ratio,
    );
    if (!result) return null;
    tree = result.tree;
    const size = sizeByTabId.get(target.activeTabId) ?? {
      cols: opts.initialCols,
      rows: opts.initialRows,
    };
    spawnSession(newTabId, size.cols, size.rows, undefined, cwd ?? actualCwdOf(target.activeTabId));
    focusedTileId = newTileId;
    opts.onDirty();
    return { tileId: newTileId, tabId: newTabId };
  }

  function newTab(tileId: TileId, shellOverride?: string, cwd?: string): TabId | null {
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
    spawnSession(
      newTabId,
      size.cols,
      size.rows,
      shellOverride,
      cwd ?? actualCwdOf(target.activeTabId),
    );
    opts.onDirty();
    return newTabId;
  }

  /**
   * ポップアップを開く。既に開いていれば何もしない（同時に1つだけ、ADR 0005）。
   * commandを指定すると、デフォルトシェル（WSLプロファイル等も含む）の-c/-Command相当で
   * そのコマンドをexecする（ワンショット実行、pty.tsのappendCommandArgs参照）。
   * execで置き換わるため、コマンド終了=シェルプロセス終了となりPTYのonExitが自然に発火し、
   * handleTabProcessExitのpopup分岐で自動的に閉じる（明示的なexit送信は不要）。
   * 以前は「PTY起動→send-keys相当でcommand+exitを流し込む」方式だったが、シェルの初期化が
   * 完了する前にコマンド文字列が届いてしまう競合や、フルスクリーンTUI（lazygit等）の起動中に
   * exitが意図しない入力として吸われてしまう問題があったため、この方式に置き換えた。
   */
  function openPopup(popupOpts: OpenPopupOptions = {}): TabId | null {
    if (popupTabId) return null;
    const newTabId = genTabId();
    const focusedLeaf = findNode(tree, focusedTileId);
    const activeTabId = focusedLeaf?.kind === "leaf" ? focusedLeaf.activeTabId : undefined;
    const inheritedCwd = activeTabId !== undefined ? actualCwdOf(activeTabId) : undefined;
    const size = (activeTabId !== undefined ? sizeByTabId.get(activeTabId) : undefined) ?? {
      cols: opts.initialCols,
      rows: opts.initialRows,
    };
    spawnSession(
      newTabId,
      size.cols,
      size.rows,
      undefined,
      popupOpts.cwd ?? inheritedCwd,
      popupOpts.command,
    );
    popupTabId = newTabId;
    popupVisible = true;
    popupWidth = popupOpts.width;
    popupHeight = popupOpts.height;
    opts.onDirty();
    return newTabId;
  }

  function closePopup(): boolean {
    if (!popupTabId) return false;
    disposeSessions([popupTabId]);
    popupTabId = null;
    popupVisible = false;
    popupWidth = undefined;
    popupHeight = undefined;
    opts.onDirty();
    return true;
  }

  /** ポップアップの表示/非表示を切り替える。戻り値はトグル後の可視状態。popupが開いていなければnull */
  function togglePopupVisibility(): boolean | null {
    if (!popupTabId) return null;
    popupVisible = !popupVisible;
    opts.onDirty();
    return popupVisible;
  }

  /**
   * 開いているポップアップの中身を、フォーカス中タイルへ通常タブとして編入する（タブへ昇格。ADR 0005）。
   * PTYセッションは作り直さない（sessionsマップ上は同じtabIdのまま。popupTabIdによる特別扱いを外すだけ）。
   * 昇格先は常にフォーカス中タイル（タイル選択UIは作らない方針。openPopup同様の暗黙対象）
   */
  function promotePopup(): { tileId: TileId; tabId: TabId } | null {
    if (!popupTabId) return null;
    const result = addTabToTile(tree, focusedTileId, popupTabId);
    if (!result) return null;
    tree = result;
    const promoted = { tileId: focusedTileId, tabId: popupTabId };
    popupTabId = null;
    popupVisible = false;
    popupWidth = undefined;
    popupHeight = undefined;
    opts.onDirty();
    return promoted;
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

  // CLI経由のbrowserNavigate成功後にworkspace.ts側の状態を追従させるためのセッター。webviewの実表示には影響しない
  function setBrowserTabUrl(tabId: TabId, url: string): boolean {
    if (!browserTabs.has(tabId)) return false;
    browserTabs.set(tabId, { url });
    opts.onDirty();
    return true;
  }

  function switchTab(tileId: TileId, tabId: TabId): boolean {
    const result = switchActiveTab(tree, tileId, tabId);
    if (!result) return false;
    tree = result;
    opts.onDirty();
    return true;
  }

  // ドラッグ&ドロップによるタブのタイル間移動。PTYセッション自体はtabId単位で管理しており
  // tileIdに紐づかないため、moveTabToTileが返すtree（木構造）だけ差し替えればよい
  function moveTab(fromTileId: TileId, tabId: TabId, toTileId: TileId): boolean {
    const result = moveTabToTile(tree, fromTileId, tabId, toTileId);
    if (!result) return false;
    tree = result.tree;
    if (result.removedTileId) tileNames.delete(result.removedTileId);
    focusedTileId = toTileId;
    opts.onDirty();
    return true;
  }

  // タイルに複数タブがあればアクティブタブだけ閉じる。最後の1タブだった場合はタイルごと閉じる
  // （そのタイルがワークスペース最後の1枚だった場合のみ、誤操作防止のため何もしない）
  function closeTab(tileId: TileId, tabId: TabId): boolean {
    const result = closeTabInTile(tree, tileId, tabId);
    if (!result || result.tree === null) return false;
    applyCloseResult(result.tree, [result.closedTabId], result.tileClosed ? tileId : undefined);
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

  // niwa.tile.resize向け（tmuxのresize-pane相当）。指定tileIdから見てdirection方向の軸に
  // 一致する祖先splitが無い場合はfalse（例: 単一tileのワークスペースや、上下splitしか無いtileを
  // left/rightへリサイズしようとした場合）
  function resizeTileInDirection(
    tileId: TileId,
    direction: "up" | "down" | "left" | "right",
    delta: number,
  ): boolean {
    const newTree = resizeInDirection(tree, tileId, direction, delta);
    if (!newTree) return false;
    tree = newTree;
    opts.onDirty();
    return true;
  }

  // niwa.tab.respawn向け（tmuxのrespawn-pane -k相当。動作中でも常に強制終了して再起動する）。
  // tabIdが存在しない・browserタブの場合はfalse
  function respawnTab(
    tabId: TabId,
    shellOverride?: string,
    cwd?: string,
    command?: string,
  ): boolean {
    if (!sessions.has(tabId) || browserTabs.has(tabId)) return false;
    const size = sizeByTabId.get(tabId) ?? { cols: opts.initialCols, rows: opts.initialRows };
    const resolvedCwd = cwd ?? actualCwdOf(tabId);
    sessions.get(tabId)?.dispose();
    sessions.delete(tabId);
    spawnSession(tabId, size.cols, size.rows, shellOverride, resolvedCwd, command);
    opts.onDirty();
    return true;
  }

  function handleInput(tabId: TabId, data: string): void {
    sessions.get(tabId)?.write(data);
  }

  function handlePaste(tabId: TabId, data: string): void {
    sessions.get(tabId)?.paste(data);
  }

  // スクロールはPTYを経由しないため、input/pasteと違いonOutput→onDirtyの連鎖が起きない。
  // 呼び出し側で明示的にonDirty()し再描画をスケジュールする必要がある
  function handleScroll(tabId: TabId, deltaLines: number): void {
    if (!sessions.has(tabId)) return;
    sessions.get(tabId)?.scroll(deltaLines);
    opts.onDirty();
  }

  function handleScrollToTop(tabId: TabId): void {
    if (!sessions.has(tabId)) return;
    sessions.get(tabId)?.scrollToTop();
    opts.onDirty();
  }

  function handleScrollToBottom(tabId: TabId): void {
    if (!sessions.has(tabId)) return;
    sessions.get(tabId)?.scrollToBottom();
    opts.onDirty();
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
    return {
      layout: tree,
      focusedTileId,
      tabs,
      tabNames: Object.fromEntries(tabNames),
      tileNames: Object.fromEntries(tileNames),
      popup: popupTabId
        ? { tabId: popupTabId, visible: popupVisible, width: popupWidth, height: popupHeight }
        : null,
    };
  }

  /** サイドバー一覧用の軽量な参照。PTY内容のrenderStateは計算しない */
  function listTabNames(): Record<TabId, string> {
    return Object.fromEntries(tabNames);
  }

  /** サイドバー一覧用の軽量な参照。PTY内容のrenderStateは計算しない */
  function listTileNames(): Record<TileId, string> {
    return Object.fromEntries(tileNames);
  }

  /**
   * サイドバー一覧用の軽量な参照。非アクティブワークスペースでも（あるいは表示中で
   * ウィンドウ上は隠れていても）ポップアップの有無・表示状態を把握できるようにする
   */
  function getPopupInfo(): { tabId: TabId; visible: boolean } | null {
    return popupTabId ? { tabId: popupTabId, visible: popupVisible } : null;
  }

  /** 永続化用の軽量スナップショット（PTY内容は含まない）。terminal/browser問わず全タブの現在状態を返す */
  /** ポップアップは一時的な画面のため永続化対象から除外する */
  function getPersistableTabs(): Record<TabId, PersistedTab> {
    const result: Record<TabId, PersistedTab> = {};
    for (const tabId of sessions.keys()) {
      if (tabId === popupTabId) continue;
      const tab: PersistedTerminalTab = { kind: "terminal" };
      const shell = shellByTabId.get(tabId);
      if (shell !== undefined) tab.shell = shell;
      const name = tabNames.get(tabId);
      if (name !== undefined) tab.name = name;
      const vars = tabVars.get(tabId);
      if (vars && vars.size > 0) tab.vars = Object.fromEntries(vars);
      result[tabId] = tab;
    }
    for (const [tabId, state] of browserTabs) {
      const tab: PersistedBrowserTab = { kind: "browser", url: state.url };
      const name = tabNames.get(tabId);
      if (name !== undefined) tab.name = name;
      const vars = tabVars.get(tabId);
      if (vars && vars.size > 0) tab.vars = Object.fromEntries(vars);
      result[tabId] = tab;
    }
    return result;
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

  /** terminalセッション・ブラウザタブいずれとしても存在しないtabIdはfalse */
  function hasAnyTab(tabId: TabId): boolean {
    return hasTab(tabId) || hasBrowserTab(tabId);
  }

  function setTabVar(tabId: TabId, key: string, value: string): boolean {
    if (!hasAnyTab(tabId)) return false;
    let vars = tabVars.get(tabId);
    if (!vars) {
      vars = new Map();
      tabVars.set(tabId, vars);
    }
    vars.set(key, value);
    opts.onDirty();
    return true;
  }

  function getTabVar(tabId: TabId, key: string): GetTabVarResult {
    if (!hasAnyTab(tabId)) return { found: false, reason: "tab-not-found" };
    const value = tabVars.get(tabId)?.get(key);
    return value === undefined ? { found: false, reason: "not-set" } : { found: true, value };
  }

  /** tabId不存在はnull。存在するが未設定は空オブジェクト */
  function listTabVars(tabId: TabId): Record<string, string> | null {
    if (!hasAnyTab(tabId)) return null;
    const vars = tabVars.get(tabId);
    return vars ? Object.fromEntries(vars) : {};
  }

  /** 空文字列（trim後）を渡すとデフォルトの連番ラベルへ戻す */
  function setTabName(tabId: TabId, name: string): boolean {
    if (!hasAnyTab(tabId)) return false;
    if (name.trim() === "") {
      tabNames.delete(tabId);
    } else {
      tabNames.set(tabId, name);
    }
    opts.onDirty();
    return true;
  }

  /** 空文字列（trim後）を渡すとデフォルトの連番ラベルへ戻す */
  function setTileName(tileId: TileId, name: string): boolean {
    if (!findNode(tree, tileId)) return false;
    if (name.trim() === "") {
      tileNames.delete(tileId);
    } else {
      tileNames.set(tileId, name);
    }
    opts.onDirty();
    return true;
  }

  function dispose(): void {
    for (const session of sessions.values()) session.dispose();
    sessions.clear();
    browserTabs.clear();
    tabVars.clear();
    tabNames.clear();
    tileNames.clear();
  }

  return {
    splitTile: splitTileById,
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
    focusTile: focusTileById,
    focusDirection: focusDirectionFrom,
    resizeSplit: resizeSplitById,
    resizeTileInDirection,
    respawnTab,
    handleInput,
    handlePaste,
    handleResize,
    handleScroll,
    handleScrollToTop,
    handleScrollToBottom,
    snapshot,
    getLayout,
    getFocusedTileId,
    hasTab,
    hasBrowserTab,
    findTileIdForTab,
    getTabText,
    setTabVar,
    getTabVar,
    listTabVars,
    setTabName,
    setTileName,
    listTabNames,
    listTileNames,
    getPopupInfo,
    getPersistableTabs,
    dispose,
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
