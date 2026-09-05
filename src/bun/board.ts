// tile-layout.ts（純粋な木構造）と TerminalSession（I/O）を束ねる、状態を持つ層。
// 1つのBoardが1本のTileツリーを保持する（ADR 0006）。workspace.tsがBoardを複数束ね、
// bun/index.tsはworkspace-manager.ts経由でのみタイル・タブ・PTYを操作する。
import type { BrowserRenderState, BrowserTabState } from "./browser-tab";
import type { CopyModeKey } from "./copy-mode";
import type { MouseEventInput } from "./ghostty";
import { APP_VARIANT } from "./app-variant.generated";
import { getWslBridgePort, ipcSocketPath } from "./ipc-server";
import {
  EPHEMERAL_TAB_VAR_KEYS,
  type PersistedBrowserTab,
  type PersistedTab,
  type PersistedTerminalTab,
  type RestoredTreeMeta,
} from "./persistence";
import {
  addTabToTile,
  closeTabInTile,
  findNode,
  focusNeighbor,
  listLeaves,
  moveTabToNewSplit,
  moveTabToTile,
  nextTabId,
  resizeInDirection,
  resizeSplit,
  splitTile,
  switchActiveTab,
  toFlexDirection,
  type SplitOrientation,
  type SplitPlacement,
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

export type BoardId = string;

export type TabRenderState = TerminalRenderState | BrowserRenderState;

export interface BoardRenderState {
  layout: TileNode;
  focusedTileId: TileId;
  tabs: Record<TabId, TabRenderState>;
  /** ユーザーがサイドバーから設定したタブ名。未設定のタブは含まれない（表示側で連番にフォールバック） */
  tabNames: Record<TabId, string>;
  /** ユーザーがサイドバーから設定したタイル名。未設定のタイルは含まれない（表示側で連番にフォールバック） */
  tileNames: Record<TileId, string>;
  /** 一時的にズーム表示中のtileId（tmuxのresize-pane -Z相当）。永続化はしない（起動のたびnullに戻る） */
  zoomedTileId: TileId | null;
}

/** 外部（popup.ts）からTerminalSessionを編入する際に渡すメタ情報。adoptTab参照 */
export interface AdoptTabMeta {
  cols: number;
  rows: number;
  shell?: string;
  vars?: Record<string, string>;
}

export type GetTabVarResult =
  | { found: true; value: string }
  | { found: false; reason: "tab-not-found" | "not-set" };

export type BoardOptions = {
  initialCols: number;
  initialRows: number;
  /** tile/tabのid採番。複数Boardインスタンス間でのid衝突を避けるため外部（workspace-manager.ts）から注入する */
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
   * 新規Board作成時（initialTree省略時）の最初のタブに使うデフォルトcwdを取得する。
   * 省略時・戻り値undefinedはpty.ts側のOS標準ホームディレクトリを使う。
   * getDefaultShellと同様、呼び出し毎に評価する（設定ファイルのホットリロードを反映するため）
   */
  getDefaultCwd?: () => string | undefined;
  /** テスト時にfakeへ差し替えるためのDI */
  createSession?: typeof createTerminalSession;
};

export function createBoard(opts: BoardOptions) {
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
  // 一時的にズーム表示中のtileId。tree構造自体は変更しない（表示上どのleafを全画面表示するかという
  // 描画側の関心事のため）。closeTile/splitTile/focus変更で対象が意味を失う場合はクリアする
  let zoomedTileId: TileId | null = null;

  const genTileId = opts.genTileId;
  const genTabId = opts.genTabId;

  // PTY起動をwebview側の実測cols/rowsが届くまで保留中のタブ。新規タイル作成時・
  // アプリ起動時の全タブに使う固定値/分割元の全体サイズは実際の表示領域と一致しないことが多く、
  // 「起動直後にresizeで送り直す」設計だとSIGWINCH到達が子プロセスのシグナルハンドラ登録に
  // 間に合わず、取りこぼしたまま二度と追従しない（popup.tsのspawnSession保留パターンと
  // 同じ理由）。正しいサイズが判明するまでPTY自体を起動しないことでこの競合を避ける
  const pendingSpawnByTabId = new Map<
    TabId,
    { shellOverride?: string; cwd?: string; command?: string; initialInput?: string }
  >();

  /** webview側の初回resize到達まで実際のPTY起動を保留する。sizeByTabIdはまだ確定しない */
  function spawnSessionPending(tabId: TabId, shellOverride?: string, cwd?: string): void {
    pendingSpawnByTabId.set(tabId, { shellOverride, cwd });
    shellByTabId.set(tabId, shellOverride ?? opts.getDefaultShell?.());
  }

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
      // シェル統合スクリプトやタブ内のCLI呼び出しが`--tab`省略でこのタブを指せるようにする。
      // NIWATERM_SOCKET/NIWATERM_BRIDGE_PORTはniwaterm CLIが接続先を自インスタンスへ
      // 固定するために使う（devビルドと普段遣いビルドを同時に動かした際の混線防止）
      env: {
        NIWATERM_TAB_ID: tabId,
        NIWATERM_SOCKET: ipcSocketPath(),
        NIWATERM_BRIDGE_PORT: String(getWslBridgePort() ?? ""),
        NIWATERM_APP_VARIANT: APP_VARIANT,
      },
      onOutput: () => opts.onDirty(),
      onExit: () => handleTabProcessExit(tabId),
      // OSC 7等で報告された実際のcwdをtabVarsへ反映する（split-tile/newTabのcwd省略時デフォルトにも使う）
      onPwdChanged: (cwd) => setTabVar(tabId, "cwd", cwd),
    });
    sessions.set(tabId, session);
  }

  /**
   * 永続化からの復元専用。初期構築フェーズ（createBoard呼び出し中）はonDirtyを呼ばない既存方針を
   * 踏襲するため、setTabVar/setTabName等の公開セッターは経由せずtabVars/tabNames/browserTabsへ直接書き込む。
   * PTY起動はwebview側の実測cols/rowsが届く（handleResize）までspawnSessionPendingで保留する
   * （前回終了時の保存済みサイズは今回起動時のウィンドウサイズと一致するとは限らないため）。
   * タブ変数のうちEPHEMERAL_TAB_VAR_KEYSは復元しない
   */
  function restoreTab(tabId: TabId, meta: PersistedTab | undefined): void {
    if (meta?.name !== undefined) tabNames.set(tabId, meta.name);
    if (meta?.vars) {
      const entries = Object.entries(meta.vars).filter(([key]) => !EPHEMERAL_TAB_VAR_KEYS.has(key));
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
    spawnSessionPending(tabId, shell, cwd);
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
        restoreTab(tabId, meta?.tabMeta.get(tabId));
      }
    }
  } else {
    const firstTabId = genTabId();
    const firstTileId = genTileId();
    tree = { kind: "leaf", id: firstTileId, tabIds: [firstTabId], activeTabId: firstTabId };
    focusedTileId = firstTileId;
    spawnSessionPending(firstTabId, undefined, opts.initialCwd ?? opts.getDefaultCwd?.());
  }

  function disposeSessions(tabIds: TabId[]): void {
    for (const tabId of tabIds) {
      sessions.get(tabId)?.dispose();
      sessions.delete(tabId);
      sizeByTabId.delete(tabId);
      shellByTabId.delete(tabId);
      browserTabs.delete(tabId);
      pendingSpawnByTabId.delete(tabId);
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
    if (zoomedTileId && !findNode(tree, zoomedTileId)) zoomedTileId = null;
    opts.onDirty();
  }

  // シェルが1つ終了した時の挙動。そのタブだけ閉じる（同じタイルに他のタブが残っていればタイルは維持）。
  // タイル内最後のタブで、かつBoard最後の1枚だった場合のみ「アプリごと終了」を維持する。
  function handleTabProcessExit(tabId: TabId): void {
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
    // 新タイルは分割元の分割前サイズより物理的に小さくなるため、分割元の現在サイズを
    // そのまま渡さずwebview側の実測cols/rowsが届くまでPTY起動を保留する
    spawnSessionPending(newTabId, undefined, cwd ?? actualCwdOf(target.activeTabId));
    focusedTileId = newTileId;
    // ズーム中のtileを分割した場合、新しいtileが隠れたままになってしまうため自動でズーム解除する
    // （tmuxのresize-pane -Zも同様に、ペイン数が変わる操作でズームを解除する）
    if (zoomedTileId === tileId) zoomedTileId = null;
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
    // 同じタイルの既存タブと同じサイズで起動する。そのサイズがまだ実測できていない
    // （＝タイル自体がPTY起動保留中。アプリ起動直後や分割直後）場合は、initialColsの
    // 固定値で起動せずこちらも保留する。固定値で起動するとSIGWINCHを取りこぼす
    const size = sizeByTabId.get(target.activeTabId);
    const tabCwd = cwd ?? actualCwdOf(target.activeTabId);
    if (size) {
      spawnSession(newTabId, size.cols, size.rows, shellOverride, tabCwd);
    } else {
      spawnSessionPending(newTabId, shellOverride, tabCwd);
    }
    opts.onDirty();
    return newTabId;
  }

  /**
   * フォーカス中タイルのアクティブタブのcwd・サイズを返す（popup.ts側でopenPopup時のcwd/サイズ
   * 継承に使う。split-tile/newTabと同じ方針）。フォーカス中タイルが存在しない場合はundefined
   */
  function getFocusedTabSnapshot(): { cols: number; rows: number; cwd?: string } | undefined {
    const focusedLeaf = findNode(tree, focusedTileId);
    const activeTabId = focusedLeaf?.kind === "leaf" ? focusedLeaf.activeTabId : undefined;
    if (activeTabId === undefined) return undefined;
    const size = sizeByTabId.get(activeTabId) ?? { cols: opts.initialCols, rows: opts.initialRows };
    return { cols: size.cols, rows: size.rows, cwd: actualCwdOf(activeTabId) };
  }

  /**
   * popup.ts側から昇格（promote）されたTerminalSessionを、フォーカス中タイルへ通常タブとして
   * 編入する（ADR 0006）。PTYセッションは作り直さない（callback配線だけこのBoard用へ差し替える）。
   * 昇格先は常に呼び出し時点のフォーカス中タイル（タイル選択UIは作らない方針、旧promotePopupと同じ）
   */
  function adoptTab(tabId: TabId, session: TerminalSession, meta: AdoptTabMeta): boolean {
    const result = addTabToTile(tree, focusedTileId, tabId);
    if (!result) return false;
    tree = result;
    session.setCallbacks({
      onOutput: () => opts.onDirty(),
      onExit: () => handleTabProcessExit(tabId),
      onPwdChanged: (cwd) => setTabVar(tabId, "cwd", cwd),
    });
    sessions.set(tabId, session);
    sizeByTabId.set(tabId, { cols: meta.cols, rows: meta.rows });
    shellByTabId.set(tabId, meta.shell);
    if (meta.vars) tabVars.set(tabId, new Map(Object.entries(meta.vars)));
    opts.onDirty();
    return true;
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

  /** leaf内でアクティブタブをdelta方向へ巡回移動する。タイルが無い・タブが1枚だけならfalse */
  function cycleTab(tileId: TileId, delta: 1 | -1): boolean {
    const leaf = findNode(tree, tileId);
    if (!leaf || leaf.kind !== "leaf" || leaf.tabIds.length < 2) return false;
    return switchTab(tileId, nextTabId(leaf, delta));
  }

  // ドラッグ&ドロップによるタブのタイル間移動。PTYセッション自体はtabId単位で管理しており
  // tileIdに紐づかないため、moveTabToTileが返すtree（木構造）だけ差し替えればよい
  function moveTab(fromTileId: TileId, tabId: TabId, toTileId: TileId): boolean {
    const result = moveTabToTile(tree, fromTileId, tabId, toTileId);
    if (!result) return false;
    tree = result.tree;
    if (result.removedTileId) {
      tileNames.delete(result.removedTileId);
      if (zoomedTileId === result.removedTileId) zoomedTileId = null;
    }
    focusedTileId = toTileId;
    opts.onDirty();
    return true;
  }

  // タブをタイルの端へドロップしての画面分割。新しいタイルへ入るのは既存タブなので、
  // moveTabと同じくtree（木構造）の差し替えだけで済む（PTYの起動は要らない）
  function moveTabToSplit(
    fromTileId: TileId,
    tabId: TabId,
    targetTileId: TileId,
    orientation: SplitOrientation,
    placement: SplitPlacement,
  ): boolean {
    const result = moveTabToNewSplit(
      tree,
      fromTileId,
      tabId,
      { tileId: targetTileId, direction: toFlexDirection(orientation), placement },
      { splitId: genTileId(), tileId: genTileId() },
    );
    if (!result) return false;
    tree = result.tree;
    if (result.removedTileId) {
      tileNames.delete(result.removedTileId);
      if (zoomedTileId === result.removedTileId) zoomedTileId = null;
    }
    // 分割で増えたタイルが隠れたままにならないよう、splitTileと同じくズームを解除する
    if (zoomedTileId === targetTileId) zoomedTileId = null;
    focusedTileId = result.newTileId;
    opts.onDirty();
    return true;
  }

  // タイルに複数タブがあればアクティブタブだけ閉じる。最後の1タブだった場合はタイルごと閉じる
  // （そのタイルがBoard最後の1枚だった場合のみ、誤操作防止のため何もしない）
  function closeTab(tileId: TileId, tabId: TabId): boolean {
    const result = closeTabInTile(tree, tileId, tabId);
    if (!result || result.tree === null) return false;
    applyCloseResult(result.tree, [result.closedTabId], result.tileClosed ? tileId : undefined);
    return true;
  }

  function focusTileById(tileId: TileId): boolean {
    if (!findNode(tree, tileId)) return false;
    focusedTileId = tileId;
    // ズーム中に別tileへフォーカスを移した場合、ズーム中の画面には移動先が見えず操作できないため
    // 自動でズーム解除する（tmuxのresize-pane -Zも、ズーム中にペインを切り替えると自動解除される）
    if (zoomedTileId && zoomedTileId !== tileId) zoomedTileId = null;
    opts.onDirty();
    return true;
  }

  function focusDirectionFrom(direction: "up" | "down" | "left" | "right"): void {
    const next = focusNeighbor(tree, focusedTileId, direction);
    if (next) {
      focusedTileId = next;
      if (zoomedTileId && zoomedTileId !== next) zoomedTileId = null;
      opts.onDirty();
    }
  }

  /**
   * ズーム表示の切り替え（tmuxのresize-pane -Z相当）。tileIdはleafである必要がある
   * （splitのidを渡すと、reconcile側の「対象を含まない枝を隠す」ロジックが両側とも除外扱いになり
   * 表示が壊れるため）。leafでない・存在しない場合はnull、それ以外はトグル後の状態を返す
   */
  function toggleZoomTile(tileId: TileId): boolean | null {
    const target = findNode(tree, tileId);
    if (!target || target.kind !== "leaf") return null;
    zoomedTileId = zoomedTileId === tileId ? null : tileId;
    opts.onDirty();
    return zoomedTileId === tileId;
  }

  function resizeSplitById(splitId: TileId, ratio: number): void {
    tree = resizeSplit(tree, splitId, ratio);
    opts.onDirty();
  }

  // niwa.tile.resize向け（tmuxのresize-pane相当）。指定tileIdから見てdirection方向の軸に
  // 一致する祖先splitが無い場合はfalse（例: 単一tileのBoardや、上下splitしか無いtileを
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
    if (browserTabs.has(tabId)) return false;
    // PTY起動待ち（spawnSessionPending）のタブへのrespawnは、保留中のパラメータを
    // 上書きするだけにとどめる。実際の起動はhandleResizeでの実測cols/rows到達を待つ
    // （niwa.tile.split直後にniwa.tab.respawnでcommandを渡すconfig.tsパターンでは、
    // 対象タブがまだsessionsに登録されていない）
    const pending = pendingSpawnByTabId.get(tabId);
    if (pending) {
      pendingSpawnByTabId.set(tabId, {
        shellOverride: shellOverride ?? pending.shellOverride,
        cwd: cwd ?? pending.cwd,
        command,
      });
      if (shellOverride !== undefined) shellByTabId.set(tabId, shellOverride);
      opts.onDirty();
      return true;
    }
    if (!sessions.has(tabId)) return false;
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

  /**
   * タブ作成直後に流し込む入力（layoutsプリセットのcommand等）を送る。PTY起動待ち
   * （spawnSessionPending）のタブでは保留キューへ積み、実測cols/rows到達時に
   * 起動と続けて流す。handleInputはsessions未登録のタブでは黙って捨てるため、
   * splitTile直後のタブ（新タイルのプレースホルダーは常に起動保留中）へは届かない
   * （respawnTabで先に塞いだのと同じ穴）。tabIdが存在しない場合はfalseを返す
   */
  function sendInitialInput(tabId: TabId, data: string): boolean {
    const pending = pendingSpawnByTabId.get(tabId);
    if (pending) {
      pending.initialInput = (pending.initialInput ?? "") + data;
      return true;
    }
    const session = sessions.get(tabId);
    if (!session) return false;
    session.writeWhenReady(data);
    return true;
  }

  function handlePaste(tabId: TabId, data: string): void {
    sessions.get(tabId)?.paste(data);
  }

  function handleMouseEvent(tabId: TabId, ev: MouseEventInput): void {
    sessions.get(tabId)?.mouseEvent(ev);
  }

  // コピーモードはPTYを経由しないため、handleScrollと同じくonDirty()で再描画を促す必要がある
  function enterCopyMode(tabId: TabId): void {
    const session = sessions.get(tabId);
    if (!session) return;
    session.enterCopyMode();
    opts.onDirty();
  }

  /** コピーモード中のキー。コピーモードでない・未割当のキーならfalseを返す */
  function handleCopyModeKey(tabId: TabId, key: CopyModeKey): boolean {
    const session = sessions.get(tabId);
    if (!session?.handleCopyModeKey(key)) return false;
    opts.onDirty();
    return true;
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
    const pending = pendingSpawnByTabId.get(tabId);
    if (pending) {
      pendingSpawnByTabId.delete(tabId);
      spawnSession(tabId, cols, rows, pending.shellOverride, pending.cwd, pending.command);
      // 生成時はcols/rowsしか渡らないため、セルの実寸はここで伝える（マウスレポートの座標変換に必要）
      sessions.get(tabId)?.setCellSize(cellWidthPx, cellHeightPx);
      // 起動を待たせていた間に積まれた入力（layoutsプリセットのcommand等）をここで流す。
      // 起動直後のシェルは入力を取りこぼすため、writeWhenReadyで準備完了を待たせる
      if (pending.initialInput) sessions.get(tabId)?.writeWhenReady(pending.initialInput);
      opts.onDirty();
      return;
    }
    const session = sessions.get(tabId);
    if (!session) return;
    if (session.resize(cols, rows, cellWidthPx, cellHeightPx)) {
      sizeByTabId.set(tabId, { cols, rows });
      opts.onDirty();
    }
  }

  function snapshot(): BoardRenderState {
    const tabs: Record<TabId, TabRenderState> = {};
    for (const [tabId, session] of sessions) {
      tabs[tabId] = session.renderState();
    }
    // PTY起動保留中でも.term要素を生成させ、ResizeObserverによる実測cols/rows到達
    // （handleResize）を発火させる必要があるため、空のterminal renderStateを返す
    for (const tabId of pendingSpawnByTabId.keys()) {
      tabs[tabId] = {
        kind: "terminal",
        html: "",
        cursorX: 0,
        cursorY: 0,
        cursorVisible: false,
        cursorShape: "block",
        viewportPinned: true,
        mouseTracking: false,
        mouseAnyMotion: false,
        copyMode: null,
      };
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
      zoomedTileId,
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

  /** 永続化用の軽量スナップショット（PTY内容は含まない）。terminal/browser問わず全タブの現在状態を返す */
  function getPersistableTabs(): Record<TabId, PersistedTab> {
    const result: Record<TabId, PersistedTab> = {};
    for (const tabId of new Set([...sessions.keys(), ...pendingSpawnByTabId.keys()])) {
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

  /** サイドバー一覧用の軽量な参照。ズーム中でなければnull */
  function getZoomedTileId(): TileId | null {
    return zoomedTileId;
  }

  function hasTab(tabId: TabId): boolean {
    return sessions.has(tabId) || pendingSpawnByTabId.has(tabId);
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
    getFocusedTabSnapshot,
    adoptTab,
    switchTab,
    cycleTab,
    moveTab,
    moveTabToSplit,
    closeTab,
    focusTile: focusTileById,
    focusDirection: focusDirectionFrom,
    toggleZoomTile,
    resizeSplit: resizeSplitById,
    resizeTileInDirection,
    respawnTab,
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
    getLayout,
    getFocusedTileId,
    getZoomedTileId,
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
    getPersistableTabs,
    dispose,
  };
}

export type Board = ReturnType<typeof createBoard>;
