import Electrobun, {
  ApplicationMenu,
  BrowserView,
  BrowserWindow,
  type RPCSchema,
  Screen,
  Utils,
} from "electrobun/bun";
import { APP_VARIANT } from "./app-variant.generated";
import type {
  KeybindingsConfig,
  LayoutsConfig,
  NiwaBellEvent,
  NiwaBellHandler,
  NiwaNotifyOptions,
  ResolvedAppearanceConfig,
  ResolvedBoardConfig,
  ResolvedBrowserConfig,
  ResolvedCustomViewConfig,
  ResolvedMouseConfig,
  ShellProfile,
} from "@niwaterm/config";
import { applyAndBindStartupLayout } from "./board-startup";
import { createBrowserBridge } from "./browser-bridge";
import { captureUrlScreenshot } from "./browser-screenshot";
import { readClipboardText, setClipboardWriteListener, writeClipboardText } from "./clipboard";
import { cleanupConfigImportDir, configFilePath, loadAndResolveConfig } from "./config";
import { buildConfigSummary, type ConfigSummary } from "./config-summary";
import { watchConfigFile } from "./config-watcher";
import { createDirExistenceCache, dirExistsSync } from "./dir-existence";
import type { MouseEventInput } from "./ghostty";
import { createIpcServer, ipcSocketPath, type IpcServer } from "./ipc-server";
import { applyLayoutPreset } from "./layout-apply";
import { listResolvedLayouts, loadProjectPreset, type LayoutListEntry } from "./project-config";
import { DEFAULT_RESIZE_AMOUNT } from "./niwa-api";
import { isAllowedLinkUrl } from "./open-link";
import { resolveBoardNewTabCwd, resolveWorktreeInputPath } from "./board-worktree";
import { loadPersistedState, persistedFilePath, savePersistedState } from "./persistence";
import type { SelectionMenuEntry, SelectionMenuHandle } from "./selection-menu";
import { detectShellProfiles, resolveShellProfileCommand } from "./shell-profiles";
import type { SplitOrientation, SplitPlacement, TabId, TileId } from "./tile-layout";
import { enableWindowTransparency } from "./win-window";
import { sendWindowsNotification } from "./windows-notification";
import {
  isFrameRestorable,
  loadWindowState,
  resolveWindowFrame,
  saveWindowState,
  type ScreenArea,
  type WindowFrame,
  windowStateFilePath,
} from "./window-state";
import {
  createWorkspaceManager,
  type AppRenderState,
  type BoardId,
  type WorkspaceId,
} from "./workspace-manager";

// macOSではメニューが無いとCmd+C/Cmd+V等のkey equivalentがWebViewに届かないため、標準メニューを設定する。
// これはmacOS固有の事情（key equivalentがメニュー経由で配送される）への対処なので他OSでは設定しない
if (process.platform === "darwin") {
  ApplicationMenu.setApplicationMenu([
    {
      label: "niwaterm",
      submenu: [
        { role: "hide", accelerator: "Command+H" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "divider" },
        { role: "quit", accelerator: "Command+Q" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo", accelerator: "Command+Z" },
        { role: "redo", accelerator: "Command+Shift+Z" },
        { type: "divider" },
        { role: "cut", accelerator: "Command+X" },
        { role: "copy", accelerator: "Command+C" },
        { role: "paste", accelerator: "Command+V" },
        { role: "selectAll", accelerator: "Command+A" },
      ],
    },
  ]);
}

export type NiwaRPC = {
  bun: RPCSchema<{
    requests: {
      /**
       * サイドバーの起動時レイアウトメニューに並べるプリセット一覧。プロジェクトローカルの
       * プリセットは対象Boardのフォーカス中タブのcwdから解決するため、そのBoardのタブで
       * `niwaterm layout list`を叩いたのと同じ結果になる
       */
      listBoardLayouts: {
        params: { boardId: BoardId };
        response: { layouts: LayoutListEntry[] };
      };
      /**
       * 選択範囲を右クリックした時に出すユーザー定義項目（mouse.selectionMenu）。
       * 項目のrunはbun側に残るため、webviewへはidとラベルだけを返す
       */
      selectionMenuItems: {
        params: { tabId: TabId; text: string };
        response: { items: SelectionMenuEntry[] };
      };
    };
    messages: {
      log: { msg: string };
      ready: {};
      input: { tabId: TabId; data: string };
      paste: { tabId: TabId; data: string };
      /** マウスレポート有効時（TUIアプリ等）にwebviewから転送されるマウス操作 */
      mouseEvent: { tabId: TabId; event: MouseEventInput };
      /** vi風コピーモードへ入る（キーバインド・コマンドパレットから） */
      enterCopyMode: { tabId: TabId };
      /** コピーモード中のキー入力。未割当キーはbun側で無視する */
      copyModeKey: { tabId: TabId; key: string; ctrl: boolean };
      scroll: { tabId: TabId; deltaLines: number };
      scrollToTop: { tabId: TabId };
      scrollToBottom: { tabId: TabId };
      copySelection: { text: string };
      pasteFromClipboard: { tabId: TabId };
      openLink: { url: string };
      resize: {
        tabId: TabId;
        cols: number;
        rows: number;
        cellWidth: number;
        cellHeight: number;
      };
      splitTile: { tileId: TileId; orientation: SplitOrientation };
      newTab: { tileId: TileId; shellProfileId?: string; cwd?: string };
      newBrowserTab: { tileId: TileId; url?: string };
      newCustomViewTab: { tileId: TileId };
      openPopup: {};
      closePopup: {};
      togglePopupVisibility: {};
      promotePopup: {};
      zoomFontSize: { delta: number };
      resetFontSizeZoom: {};
      switchTab: { tileId: TileId; tabId: TabId };
      moveTab: { fromTileId: TileId; tabId: TabId; toTileId: TileId };
      /** タブをタイルの端へドロップしての画面分割。targetTileIdを分割し、生まれた新タイルへタブを移す */
      moveTabToSplit: {
        fromTileId: TileId;
        tabId: TabId;
        targetTileId: TileId;
        orientation: SplitOrientation;
        placement: SplitPlacement;
      };
      closeTab: { tileId: TileId; tabId: TabId };
      /** mainview側のConfirmDialogで確認済みのタブ再起動要求（niwa.tab.respawnと同機構、常にデフォルトシェル・元cwd引き継ぎ） */
      restartTab: { tabId: TabId };
      focusTile: { tileId: TileId };
      focusDirection: { direction: "up" | "down" | "left" | "right" };
      toggleZoomTile: { tileId: TileId };
      resizeTileInDirection: { direction: "up" | "down" | "left" | "right" };
      resizeSplit: { splitId: TileId; ratio: number };
      newWorkspace: {};
      switchWorkspace: { workspaceId: WorkspaceId };
      /** サイドバーのD&D・move-workspace-*キーバインドからの並び替え。toIndexは0始まり（範囲外はbun側でクランプ） */
      moveWorkspace: { workspaceId: WorkspaceId; toIndex: number };
      closeWorkspace: { workspaceId: WorkspaceId };
      newBoard: { workspaceId: WorkspaceId; cwd?: string };
      switchBoard: { boardId: BoardId };
      /** サイドバーのD&D・move-board-*キーバインドからの並び替え。toIndexは所属ワークスペース内の0始まりの位置（範囲外はbun側でクランプ） */
      moveBoard: { boardId: BoardId; toIndex: number };
      /**
       * サイドバーの別ワークスペースへのD&D・move-board-to-workspaceのピッカーからの移動。
       * toIndexは移動先ワークスペース内の0始まりの挿入位置で、省略時は末尾。
       * 移動元が空になる（＝そのワークスペースが畳まれる）場合の確認はwebview側が取ってから送る
       */
      moveBoardToWorkspace: { boardId: BoardId; workspaceId: WorkspaceId; toIndex?: number };
      closeBoard: { boardId: BoardId };
      renameTab: { tabId: TabId; name: string };
      renameTile: { tileId: TileId; name: string };
      renameWorkspace: { workspaceId: WorkspaceId; name: string };
      renameBoard: { boardId: BoardId; name: string };
      /**
       * set-board-worktreeアクション・サイドバーの右クリックからのワークツリー紐づけの張り替え。
       * pathは入力欄の生の値（相対パス可。空文字列とnullは紐づけ解除）で、絶対パスへの解決はbun側で行う
       */
      setBoardWorktreePath: { boardId: BoardId; path: string | null };
      /**
       * サイドバーの右クリックからのレイアウト適用。選んだプリセットをそのBoardへ今すぐ適用し、
       * 起動時レイアウトとしても紐づける（CLIの`layout apply --replace --startup`と同じ）。
       * 既存タブを閉じる確認と、プロジェクトローカル由来の場合のtrust確認はwebview側で取ってから送る
       */
      applyBoardLayout: { boardId: BoardId; preset: string; trust?: boolean };
      /** サイドバーの右クリックからの起動時レイアウトの紐づけ解除（CLIの`board startup clear`と同じ） */
      clearBoardStartup: { boardId: BoardId };
      /** keybindingsのBindingTargetがkind:"custom"の場合に発火する。handlerIdはniwa-api.tsのhandlerRegistryのキー */
      runKeybindHandler: { handlerId: string };
      /** 右クリックメニューで選ばれたユーザー定義項目。idはselectionMenuItemsで返したもの */
      runSelectionMenuItem: { id: string };
      /** reload-configキーバインド・コマンドパレットからの手動リロード要求。ファイル監視での自動リロードと同じhandleConfigFileChangedを呼ぶ */
      reloadConfig: {};
      /** niwatermのウィンドウのフォーカス状態。ベルの通知要否・既読判定に使う */
      windowFocusChanged: { focused: boolean };
    };
  }>;
  webview: RPCSchema<{
    requests: {
      /** ブラウザタブのURLを遷移する。次のdom-ready（またはmainview側の内部タイムアウト）まで待って解決する */
      browserNavigate: {
        params: { tabId: TabId; url: string };
        response: { ok: true } | { ok: false; error: string };
      };
      /**
       * ブラウザタブ（OOPIF）内でJSを実行し、host-message経由の結果を待って返す汎用プリミティブ。
       * MVPではgetText/getHTML用の固定コードのみbun側から渡す想定
       * （CLIから任意JSを直接指定できるようにはしない。click/fill実装時にセキュリティ境界を再検討する）
       */
      execBrowserJs: {
        params: { tabId: TabId; code: string };
        response: { ok: true; result: unknown } | { ok: false; error: string };
      };
    };
    messages: {
      render: AppRenderState;
      config: {
        keybindings: KeybindingsConfig;
        appearance: ResolvedAppearanceConfig;
        mouse: ResolvedMouseConfig;
        customView: ResolvedCustomViewConfig | null;
        shellProfiles: ShellProfile[];
        /** 設定モーダル（show-config）に出す現在の設定値。CLIの`niwaterm config show`と同じ内容 */
        configSummary: ConfigSummary;
      };
      copied: { chars: number; lines: number };
    };
  }>;
};

// 描画は16msでコアレス（連続出力時のRPC洪水を防ぐ）
let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  setTimeout(() => {
    renderScheduled = false;
    render();
  }, 16);
}

function render() {
  // onDirty経由でPTYの初回出力等から即座に呼ばれうるため、mainWindow構築（このファイル末尾の
  // new BrowserWindow）が完了する前にscheduleRenderのsetTimeoutが発火する競合状態がありうる。
  // 未構築時はmainWindowの参照自体はTDZに引っかからずundefinedを返す（Bunのバンドラーがトップ
  // レベルconstをvar相当にscope-hoistingしているため）ので、明示的にガードする必要がある
  // （実機で発生確認済み。ガード無しだとsetTimeoutコールバック内の例外でWorker全体が落ちる）
  if (!mainWindow) return;
  const rpcSend = (mainWindow.webview.rpc as any)?.send;
  if (!rpcSend) return;
  // 画面に出ているタブのベルは既読として消す。描画のたびに拾うことで、タブ切替・Board切替・
  // ワークスペース切替・ウィンドウのフォーカス復帰のどの経路でも取りこぼさない
  if (windowFocused) workspaceManager.clearBellOnVisibleTabs();
  const snap = workspaceManager.snapshot();
  dropUnchangedPaletteCss(snap);
  mainWindow.setTitle(
    snap.workspaceIds.length === 1
      ? APP_VARIANT
      : `${APP_VARIANT} — Workspace ${snap.workspaceIds.indexOf(snap.activeWorkspaceId) + 1}/${snap.workspaceIds.length}`,
  );
  rpcSend.render(snap);
}

/**
 * 前回webviewへ送ったのと同じパレットCSSをnullへ潰す。パレットは6KB強ある一方、
 * OSC 4等で塗り替えられない限り変わらないため、毎フレーム運ぶとRPCのペイロードが
 * 無駄に膨らむ。webviewは受け取ったパレットを保持して次回以降も使い回す（mainview側の
 * applyPaletteCss）ので、送り直しは内容が変わったときだけでよい
 */
const lastPaletteCssByTabId = new Map<TabId, string>();
function dropUnchangedPaletteCss(snap: AppRenderState): void {
  // popupのPTY描画状態もboard.tabsに同居しているため、ここを見るだけで両方拾える
  for (const [tabId, state] of Object.entries(snap.workspace.board.tabs)) {
    if (state.kind !== "terminal" || state.paletteCss === null) continue;
    if (lastPaletteCssByTabId.get(tabId) === state.paletteCss) state.paletteCss = null;
    else lastPaletteCssByTabId.set(tabId, state.paletteCss);
  }
}

function sendConfig() {
  // render()と同じ理由でmainWindow構築前に呼ばれうるためガードする
  if (!mainWindow) return;
  const rpcSend = (mainWindow.webview.rpc as any)?.send;
  if (!rpcSend) return;
  rpcSend.config({
    keybindings,
    appearance: effectiveAppearance(),
    mouse,
    customView,
    shellProfiles,
    configSummary: currentConfigSummary(),
  });
}

/**
 * クリップボードへ入った直後にwebviewへ知らせる（コピー完了バッジ用）。マウス選択・キーバインド・
 * コピーモードのどの経路でも同じ表示にするため、clipboard.tsの書き込み口から一括で拾う。
 * 表示先タブはwebview側が決めるためここでは送らない
 */
function sendCopied(text: string): void {
  // render()と同じ理由でmainWindow構築前に呼ばれうるためガードする
  if (!mainWindow) return;
  const rpcSend = (mainWindow.webview.rpc as any)?.send;
  if (!rpcSend) return;
  // 末尾の改行は数えない（行末まで選択したときに1行多く見える・空コピーで0文字と出るのを防ぐ）
  const body = text.replace(/\n+$/u, "");
  if (body === "") return;
  rpcSend.copied({ chars: [...body].length, lines: body.split("\n").length });
}
setClipboardWriteListener(sendCopied);

// キーバインド・CLI・コマンドパレットからの実行時フォントサイズ変更（configファイルの
// appearance.fontSizeとは独立したズーム量として保持する）。設定ファイルのホットリロードでは
// リセットしない: ユーザーの直近の調整はconfig編集後も維持されるべきという判断
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 48;
const FONT_SIZE_STEP = 1;
let fontSizeZoomDelta = 0;

function clampFontSize(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
}

function effectiveAppearance(): ResolvedAppearanceConfig {
  if (fontSizeZoomDelta === 0) return appearance;
  return { ...appearance, fontSize: clampFontSize(appearance.fontSize + fontSizeZoomDelta) };
}

function adjustFontSize(delta: number): number {
  const clamped = clampFontSize(appearance.fontSize + fontSizeZoomDelta + delta);
  fontSizeZoomDelta = clamped - appearance.fontSize;
  sendConfig();
  return clamped;
}

function resetFontSizeZoom(): number {
  fontSizeZoomDelta = 0;
  sendConfig();
  return appearance.fontSize;
}

// レイアウト骨格の永続化は500msでコアレス（連続ドラッグ等での書き込み過多を防ぐ）
let persistScheduled = false;
function schedulePersist() {
  if (persistScheduled) return;
  persistScheduled = true;
  setTimeout(() => {
    persistScheduled = false;
    savePersistedState(persistedFilePath(), workspaceManager.serializeForPersistence()).catch(
      (err: unknown) => {
        console.log(`[bun] failed to save persisted state: ${String(err)}`);
      },
    );
  }, 500);
}

function onDirty() {
  scheduleRender();
  schedulePersist();
}

let ipcServer: IpcServer | null = null;

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  configWatcher.close();
  worktreeExistence.dispose();
  workspaceManager.dispose();
  ipcServer?.close();
  cleanupConfigImportDir();
}

let userConfigLoaded: boolean;
let keybindings: KeybindingsConfig;
let appearance: ResolvedAppearanceConfig;
let browser: ResolvedBrowserConfig;
let boardConfig: ResolvedBoardConfig;
let customView: ResolvedCustomViewConfig | null;
let defaultShell: string | undefined;
let shellProfiles: ShellProfile[];
let layouts: LayoutsConfig;
let mouse: ResolvedMouseConfig;
let selectionMenu: SelectionMenuHandle;
let workspaceDefaultCwd: string | undefined;
let runKeybindHandler: (id: string) => Promise<void>;
let bellHandler: NiwaBellHandler | null;
let runDefaultBell: (event: NiwaBellEvent) => void;

// niwatermのウィンドウがフォーカスされているか（webview側のfocus/blurから届く）。
// OSの通知はniwatermから手が離れている時にだけ意味があるため、ベルの扱いを分けるのに使う
let windowFocused = true;

// WSLディストロの増減は稀なイベントのため起動時に1回だけ検出し、ホットリロードのたびには
// wsl.exeを呼び直さない（アプリ再起動で反映されれば十分という判断）
const detectedShellProfiles = await detectShellProfiles();

const restoreFrom = await loadPersistedState(persistedFilePath());

// ElectrobunのUtils.showNotificationはWindows実機で機能しない（windows-notification.ts参照）ため、
// Windowsだけ自前のPowerShell経由実装に差し替える
const sendNotification: (opts: NiwaNotifyOptions) => void =
  process.platform === "win32" ? sendWindowsNotification : Utils.showNotification;

// Boardに紐づくワークツリーが消えていないかの監視。renderのたびに同期statを打つわけにいかないため
// キャッシュ越しに引く（dir-existence.ts）
const worktreeExistence = createDirExistenceCache({ onChange: onDirty });

// niwa.tile/tab/popup等のAPI（設定ファイルの関数ハンドラから呼ばれる）がworkspaceManagerを
// 操作するため、config読み込み（refreshConfig）より先にworkspaceManagerを作る必要がある。
// getDefaultShell/getDefaultCwdは遅延評価のクロージャなので、生成時点でdefaultShell等が
// 未確定（refreshConfig未実行）でも問題ない
const workspaceManager = createWorkspaceManager({
  initialCols: 80,
  initialRows: 24,
  onDirty,
  restoreFrom,
  getDefaultShell: () => defaultShell,
  getDefaultCwd: () => workspaceDefaultCwd,
  // 新しいタブを開く瞬間にしか通らないので、ここだけは同期のstatで最新の存在を確かめる
  // （紐づけ先が消えていると気づかずPTYの起動自体が失敗するため）
  getNewTabCwd: (worktreePath) =>
    resolveBoardNewTabCwd(boardConfig.newTabCwd, worktreePath, dirExistsSync),
  isWorktreeMissing: (worktreePath) => worktreeExistence.isMissing(worktreePath),
  onBell: handleBell,
  onAllWorkspacesClosed: () => {
    console.log("all workspaces closed, exiting");
    cleanup();
    process.exit(0);
  },
});

/**
 * タブがBEL文字を出力した時の処理。niwa.on("bell", ...)が登録されていればそちらへ丸ごと委ね、
 * 無ければ既定の処理（マーク＋画面に出ていないタブなら通知）を行う
 */
function handleBell(tabId: TabId): void {
  const location = workspaceManager.locateTab(tabId);
  if (!location) return;
  const event: NiwaBellEvent = {
    tabId,
    tabName: workspaceManager.getTabName(tabId),
    tileId: location.tileId,
    boardId: location.boardId,
    workspaceId: location.workspaceId,
    windowFocused,
    visible: workspaceManager.isTabVisible(tabId),
  };
  if (!bellHandler) {
    runDefaultBell(event);
    return;
  }
  Promise.resolve(bellHandler(event)).catch((err: unknown) => {
    console.log(`[bun] bell handler failed: ${String(err)}`);
  });
}

function currentConfigSummary(): ConfigSummary {
  return buildConfigSummary({
    configFile: configFilePath(),
    configFileLoaded: userConfigLoaded,
    appearance: effectiveAppearance(),
    baseFontSize: appearance.fontSize,
    keybindings,
    browser,
    customView,
    defaultShell,
    shellProfiles,
    layouts,
    mouse,
    workspaceDefaultCwd,
    board: boardConfig,
  });
}

async function refreshConfig(): Promise<void> {
  ({
    userConfigLoaded,
    keybindings,
    appearance,
    browser,
    board: boardConfig,
    customView,
    defaultShell,
    shellProfiles,
    layouts,
    mouse,
    selectionMenu,
    workspaceDefaultCwd,
    runKeybindHandler,
    bellHandler,
    runDefaultBell,
  } = await loadAndResolveConfig(
    configFilePath(),
    workspaceManager,
    detectedShellProfiles,
    sendNotification,
    () => handleConfigFileChanged(),
  ));
}

await refreshConfig();

/**
 * 起動時レイアウト。restoreMode: "layout"のBoardは、保存した骨格ではなく
 * configのlayoutsプリセットで組み直す（タブのcommandも再実行される）。該当Boardは
 * workspace-manager側で骨格を復元せず単一タブの状態で作られているので、ここで組み立てる。
 *
 * 実行タイミングはconfig読み込み直後・BrowserView生成前に固定する。この時点では全タブが
 * まだPTY起動保留中（spawnSessionPending）で、プリセットのcommandも
 * sendInitialInputで保留キューへ積まれるため、実測cols/rowsが確定してから正しいサイズで
 * 一度だけシェルが起動する。プリセットが見つからない場合は単一タブのまま残し、
 * ユーザーが気づけるよう通知する。
 *
 * projectRootが紐づいているBoardは、グローバル設定ではなくそのプロジェクトの
 * .niwaterm/config.tsから引く。起動時にはcwdが無いため探索は一切行わず、
 * 紐づけを作った時点で記録した解決元をそのまま読む。タブのcwdの基準も同じ理由で
 * 紐づけ時に記録したもの（projectRoot、無ければcwd）を使う
 */
async function applyStartupLayouts(): Promise<void> {
  for (const { boardId, preset, projectRoot, cwd } of workspaceManager.listStartupLayoutBoards()) {
    const layoutPreset = projectRoot
      ? await loadProjectPreset(projectRoot, preset)
      : layouts[preset];
    if (!layoutPreset) {
      const source = projectRoot ? `${projectRoot}の.niwaterm/config.ts` : "設定";
      const message = `Board ${boardId}に紐づくレイアウトプリセット "${preset}" が${source}に見つかりません`;
      console.log(`[bun] ${message}`);
      sendNotification({ title: "起動時レイアウトを適用できません", body: message });
      continue;
    }
    const result = applyLayoutPreset(
      workspaceManager,
      shellProfiles,
      layoutPreset,
      "replace",
      boardId,
      projectRoot ? { projectRoot } : cwd !== undefined ? { invocationCwd: cwd } : {},
    );
    if (!result.ok) {
      console.log(
        `[bun] failed to apply startup layout "${preset}" to ${boardId}: ${result.error}`,
      );
      sendNotification({
        title: "起動時レイアウトの適用に失敗しました",
        body: `${preset}: ${result.error}`,
      });
    }
  }
}

await applyStartupLayouts();

// 設定ファイル変更の検知→再読み込み→RPC送信をまとめて行う。実行中に次の変更が来たら
// 1回だけ追いかけて再実行する（多重実行の抑制）。scheduleRenderは無条件で呼ぶ:
// フォントサイズ変更でcols/rowsが変わらない場合でも、新しいcellWidth/cellHeightを
// 基準にカーソルpx位置を補正する必要があるため
let configReloadInFlight = false;
let configReloadPending = false;
async function handleConfigFileChanged(): Promise<void> {
  if (configReloadInFlight) {
    configReloadPending = true;
    return;
  }
  configReloadInFlight = true;
  try {
    await refreshConfig();
    sendConfig();
    scheduleRender();
  } finally {
    configReloadInFlight = false;
    if (configReloadPending) {
      configReloadPending = false;
      void handleConfigFileChanged();
    }
  }
}

try {
  ipcServer = await createIpcServer(
    ipcSocketPath(),
    workspaceManager,
    () => customView,
    () => mainWindow.activate(),
    createBrowserBridge(() => rpc),
    captureUrlScreenshot,
    () => shellProfiles,
    () => layouts,
    () => adjustFontSize(FONT_SIZE_STEP),
    () => adjustFontSize(-FONT_SIZE_STEP),
    () => resetFontSizeZoom(),
    sendNotification,
    () => keybindings,
    currentConfigSummary,
  );
  console.log(`[bun] ipc server listening on ${ipcSocketPath()}`);
} catch (err) {
  console.log(`[bun] failed to start ipc server: ${String(err)}`);
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

const rpc = BrowserView.defineRPC<NiwaRPC>({
  // ナビゲーション待ち等は数秒かかりうるため長めに設定。実際のタイムアウト制御はmainview側の
  // 内部タイムアウト（execBrowserJs/browserNavigateハンドラ）が先に発火し、必ずresolveで返す。
  // これは万一ハンドラがハングした場合の最終防波堤
  maxRequestTime: 20000,
  handlers: {
    requests: {
      listBoardLayouts: async ({ boardId }: { boardId: BoardId }) => ({
        layouts: await listResolvedLayouts(workspaceManager.getBoardFocusedCwd(boardId), layouts),
      }),
      selectionMenuItems: async ({ tabId, text }: { tabId: TabId; text: string }) => {
        const cwd = workspaceManager.getTabVar(tabId, "cwd");
        return {
          items: await selectionMenu.build({
            text,
            tabId,
            cwd: cwd.found ? cwd.value : undefined,
          }),
        };
      },
    },
    messages: {
      log: ({ msg }: { msg: string }) => {
        console.log(`[view] ${msg}`);
      },
      ready: () => {
        // webviewが読み込み直されると保持していたパレットも消えるため、差分判定を振り出しへ戻す
        lastPaletteCssByTabId.clear();
        scheduleRender();
        sendConfig();
        focusWebviewOnce();
      },
      input: ({ tabId, data }: { tabId: TabId; data: string }) => {
        workspaceManager.handleInput(tabId, data);
      },
      paste: ({ tabId, data }: { tabId: TabId; data: string }) => {
        workspaceManager.handlePaste(tabId, data);
      },
      mouseEvent: ({ tabId, event }: { tabId: TabId; event: MouseEventInput }) => {
        workspaceManager.handleMouseEvent(tabId, event);
      },
      enterCopyMode: ({ tabId }: { tabId: TabId }) => {
        workspaceManager.enterCopyMode(tabId);
      },
      copyModeKey: ({ tabId, key, ctrl }: { tabId: TabId; key: string; ctrl: boolean }) => {
        workspaceManager.handleCopyModeKey(tabId, { key, ctrl });
      },
      scroll: ({ tabId, deltaLines }: { tabId: TabId; deltaLines: number }) => {
        workspaceManager.handleScroll(tabId, deltaLines);
      },
      scrollToTop: ({ tabId }: { tabId: TabId }) => {
        workspaceManager.handleScrollToTop(tabId);
      },
      scrollToBottom: ({ tabId }: { tabId: TabId }) => {
        workspaceManager.handleScrollToBottom(tabId);
      },
      copySelection: ({ text }: { text: string }) => {
        writeClipboardText(text);
      },
      pasteFromClipboard: ({ tabId }: { tabId: TabId }) => {
        readClipboardText().then((text) => {
          if (text) workspaceManager.handlePaste(tabId, text);
        });
      },
      openLink: ({ url }: { url: string }) => {
        if (!isAllowedLinkUrl(url)) {
          console.log(`[bun] blocked opening link with disallowed scheme: ${url}`);
          return;
        }
        Utils.openExternal(url);
      },
      resize: (p: {
        tabId: TabId;
        cols: number;
        rows: number;
        cellWidth: number;
        cellHeight: number;
      }) => {
        workspaceManager.handleResize(p.tabId, p.cols, p.rows, p.cellWidth, p.cellHeight);
      },
      splitTile: ({ tileId, orientation }: { tileId: TileId; orientation: SplitOrientation }) => {
        workspaceManager.splitTile(tileId, orientation);
      },
      newTab: ({
        tileId,
        shellProfileId,
        cwd,
      }: {
        tileId: TileId;
        shellProfileId?: string;
        cwd?: string;
      }) => {
        const resolved = resolveShellProfileCommand(shellProfiles, shellProfileId);
        if (!resolved.ok) {
          console.log(`[bun] ${resolved.error}`);
          return;
        }
        workspaceManager.newTab(tileId, resolved.command, cwd);
      },
      newBrowserTab: ({ tileId, url }: { tileId: TileId; url?: string }) => {
        workspaceManager.newBrowserTab(tileId, url ?? browser.defaultUrl);
      },
      newCustomViewTab: ({ tileId }: { tileId: TileId }) => {
        if (!customView) {
          console.log("[bun] customView is not configured; ignoring newCustomViewTab");
          return;
        }
        workspaceManager.newBrowserTab(tileId, customView.url);
      },
      openPopup: () => {
        workspaceManager.openPopup();
      },
      closePopup: () => {
        workspaceManager.closePopup();
      },
      togglePopupVisibility: () => {
        workspaceManager.togglePopupVisibility();
      },
      promotePopup: () => {
        workspaceManager.promotePopup();
      },
      zoomFontSize: ({ delta }: { delta: number }) => {
        adjustFontSize(delta);
      },
      resetFontSizeZoom: () => {
        resetFontSizeZoom();
      },
      switchTab: ({ tileId, tabId }: { tileId: TileId; tabId: TabId }) => {
        workspaceManager.switchTab(tileId, tabId);
      },
      moveTab: ({
        fromTileId,
        tabId,
        toTileId,
      }: {
        fromTileId: TileId;
        tabId: TabId;
        toTileId: TileId;
      }) => {
        workspaceManager.moveTab(fromTileId, tabId, toTileId);
      },
      moveTabToSplit: ({
        fromTileId,
        tabId,
        targetTileId,
        orientation,
        placement,
      }: {
        fromTileId: TileId;
        tabId: TabId;
        targetTileId: TileId;
        orientation: SplitOrientation;
        placement: SplitPlacement;
      }) => {
        workspaceManager.moveTabToSplit(fromTileId, tabId, targetTileId, orientation, placement);
      },
      closeTab: ({ tileId, tabId }: { tileId: TileId; tabId: TabId }) => {
        workspaceManager.closeTab(tileId, tabId);
      },
      restartTab: ({ tabId }: { tabId: TabId }) => {
        workspaceManager.respawnTab(tabId);
      },
      focusTile: ({ tileId }: { tileId: TileId }) => {
        workspaceManager.focusTile(tileId);
      },
      focusDirection: ({ direction }: { direction: "up" | "down" | "left" | "right" }) => {
        workspaceManager.focusDirection(direction);
      },
      toggleZoomTile: ({ tileId }: { tileId: TileId }) => {
        workspaceManager.toggleZoomTile(tileId);
      },
      resizeTileInDirection: ({ direction }: { direction: "up" | "down" | "left" | "right" }) => {
        const tileId = workspaceManager.getFocusedTileId();
        workspaceManager.resizeTileInDirection(tileId, direction, DEFAULT_RESIZE_AMOUNT);
      },
      resizeSplit: ({ splitId, ratio }: { splitId: TileId; ratio: number }) => {
        workspaceManager.resizeSplit(splitId, ratio);
      },
      newWorkspace: () => {
        workspaceManager.newWorkspace();
      },
      switchWorkspace: ({ workspaceId }: { workspaceId: WorkspaceId }) => {
        workspaceManager.switchWorkspace(workspaceId);
      },
      moveWorkspace: ({ workspaceId, toIndex }: { workspaceId: WorkspaceId; toIndex: number }) => {
        workspaceManager.moveWorkspace(workspaceId, toIndex);
      },
      closeWorkspace: ({ workspaceId }: { workspaceId: WorkspaceId }) => {
        workspaceManager.closeWorkspace(workspaceId);
      },
      newBoard: ({ workspaceId, cwd }: { workspaceId: WorkspaceId; cwd?: string }) => {
        workspaceManager.newBoard(workspaceId, cwd);
      },
      switchBoard: ({ boardId }: { boardId: BoardId }) => {
        workspaceManager.switchBoard(boardId);
      },
      moveBoard: ({ boardId, toIndex }: { boardId: BoardId; toIndex: number }) => {
        workspaceManager.moveBoard(boardId, toIndex);
      },
      moveBoardToWorkspace: ({
        boardId,
        workspaceId,
        toIndex,
      }: {
        boardId: BoardId;
        workspaceId: WorkspaceId;
        toIndex?: number;
      }) => {
        workspaceManager.moveBoardToWorkspace(boardId, workspaceId, toIndex);
      },
      closeBoard: ({ boardId }: { boardId: BoardId }) => {
        workspaceManager.closeBoard(boardId);
      },
      renameTab: ({ tabId, name }: { tabId: TabId; name: string }) => {
        workspaceManager.setTabName(tabId, name);
      },
      renameTile: ({ tileId, name }: { tileId: TileId; name: string }) => {
        workspaceManager.setTileName(tileId, name);
      },
      renameWorkspace: ({ workspaceId, name }: { workspaceId: WorkspaceId; name: string }) => {
        workspaceManager.setWorkspaceName(workspaceId, name);
      },
      renameBoard: ({ boardId, name }: { boardId: BoardId; name: string }) => {
        workspaceManager.setBoardName(boardId, name);
      },
      setBoardWorktreePath: ({ boardId, path }: { boardId: BoardId; path: string | null }) => {
        // 入力欄の初期値はそのBoardのフォーカス中タブのcwdなので、相対パスもそのタブ起点で解決する
        const resolved =
          path === null
            ? null
            : resolveWorktreeInputPath(
                path,
                workspaceManager.getBoardFocusedCwd(boardId),
                workspaceManager.getBoardFocusedShell(boardId),
              );
        workspaceManager.setBoardWorktreePath(boardId, resolved);
      },
      applyBoardLayout: ({
        boardId,
        preset,
        trust,
      }: {
        boardId: BoardId;
        preset: string;
        trust?: boolean;
      }) => {
        // 解決起点はそのBoardのフォーカス中タブのcwd。そのタブで`niwaterm layout apply`を
        // 叩いたのと同じ解決になり、プロジェクトローカルのプリセットも同じ顔ぶれで引ける
        const cwd = workspaceManager.getBoardFocusedCwd(boardId);
        applyAndBindStartupLayout(workspaceManager, shellProfiles, layouts, {
          boardId,
          preset,
          ...(cwd !== undefined ? { cwd } : {}),
          ...(trust !== undefined ? { trust } : {}),
        })
          .then((result) => {
            if (result.ok) return;
            console.log(`[bun] applyBoardLayout failed: ${result.error}`);
            sendNotification({ title: "レイアウトを適用できません", body: result.error });
          })
          .catch((err: unknown) => {
            console.log(`[bun] applyBoardLayout error: ${String(err)}`);
          });
      },
      clearBoardStartup: ({ boardId }: { boardId: BoardId }) => {
        workspaceManager.setBoardStartup(boardId, null);
      },
      windowFocusChanged: ({ focused }: { focused: boolean }) => {
        windowFocused = focused;
        // フォーカスが戻った時点で見えているタブのベルを既読にするため、描画をやり直す
        if (focused) scheduleRender();
      },
      runKeybindHandler: ({ handlerId }: { handlerId: string }) => {
        runKeybindHandler(handlerId).catch((err: unknown) => {
          console.log(`[bun] keybind handler error: ${String(err)}`);
        });
      },
      runSelectionMenuItem: ({ id }: { id: string }) => {
        void selectionMenu.run(id);
      },
      reloadConfig: () => {
        handleConfigFileChanged().catch((err: unknown) => {
          console.log(`[bun] manual config reload error: ${String(err)}`);
        });
      },
    },
  },
});

interface DisplayInfo {
  workArea: ScreenArea;
  isPrimary: boolean;
}

/** プライマリを先頭にした各ディスプレイの作業領域。取得できない環境では空配列 */
function screenWorkAreas(): ScreenArea[] {
  try {
    const displays = Screen.getAllDisplays() as DisplayInfo[];
    return displays
      .slice()
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map((display) => display.workArea)
      .filter((area) => area.width >= 1 && area.height >= 1);
  } catch (err: unknown) {
    console.log(`[bun] failed to query displays: ${String(err)}`);
    return [];
  }
}

// 透過の有無はウィンドウ生成時にしか決められない（Electrobunに実行時の切り替えAPIが無い）。
// 設定を変えたときは再起動が必要
const isBackgroundTransparent = appearance.backgroundOpacity < 1;

const windowFramePath = windowStateFilePath();
let windowFrame = resolveWindowFrame(loadWindowState(windowFramePath), screenWorkAreas());

const mainWindow = new BrowserWindow({
  // 開発中ビルド(niwaterm-wip-dev)と普段遣いビルド(niwaterm-daily-dev)を同時に起動した際に
  // タイトルバーで見分けられるよう、実際のアプリ名をそのまま使う
  title: APP_VARIANT,
  url: "views://mainview/index.html",
  frame: {
    width: windowFrame.width,
    height: windowFrame.height,
    x: windowFrame.x,
    y: windowFrame.y,
  },
  // 透過ウィンドウはWebView2の背景色を透明にする副作用も持つため、実際に透かすときだけ有効にする。
  // 不透明度そのものはwebview側のCSSで決まる（WebView2のDefaultBackgroundColorは
  // アルファ0か255しか受け付けず、半透明を表現できない）
  transparent: isBackgroundTransparent,
  rpc,
});

if (isBackgroundTransparent) {
  // Electrobunが立てるWS_EX_LAYEREDのままだとネイティブ枠が描画されないため、
  // 生成後にDWM側の透過へ切り替える（詳細: src/native/winwindow.c）
  enableWindowTransparency();
}

// 保存する値はネイティブ側の外枠（getFrame）から取り直す。move/resizeイベントが持つ
// width/heightはwebview（クライアント領域）のサイズで、ウィンドウ生成時に渡す外枠より
// タイトルバー・枠の分だけ小さいため、イベント値をそのまま保存すると起動のたびに縮んでいく。
// 最小化中など復元に使えない値のときは、直前に控えた値を残す
function captureWindowFrame() {
  let frame: WindowFrame;
  try {
    frame = mainWindow.getFrame();
  } catch (err: unknown) {
    console.log(`[bun] failed to read window frame: ${String(err)}`);
    return;
  }
  const rounded: WindowFrame = {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.round(frame.width),
    height: Math.round(frame.height),
  };
  if (!isFrameRestorable(rounded, screenWorkAreas())) return;
  windowFrame = rounded;
}

function saveWindowFrameNow() {
  captureWindowFrame();
  try {
    saveWindowState(windowFramePath, windowFrame);
  } catch (err: unknown) {
    console.log(`[bun] failed to save window frame: ${String(err)}`);
  }
}

// ウィンドウ枠の保存は500msでコアレスする（ドラッグ中はmove/resizeが連続で飛んでくる）
let windowFrameSaveScheduled = false;
function scheduleWindowFrameSave() {
  if (windowFrameSaveScheduled) return;
  windowFrameSaveScheduled = true;
  setTimeout(() => {
    windowFrameSaveScheduled = false;
    saveWindowFrameNow();
  }, 500);
}

mainWindow.on("move", () => scheduleWindowFrameSave());
mainWindow.on("resize", () => scheduleWindowFrameSave());

// Electrobunはアプリコードをbun Worker上で実行するため、Worker側で登録したprocess.on("exit")や
// シグナルハンドラはアプリ終了時に発火しない（Electrobunがprocess.exitを上書きし、ネイティブ側の
// quitGracefullyでプロセスを終わらせるため）。このためウィンドウを閉じただけではcleanup()＝
// 全セッションのdispose()もIPCサーバーの停止も一度も走らず、Windows実機ではbridge-port・
// niwaterm.sockが残留する（PTYの子プロセス自体はアプリのプロセス終了に伴いOSが回収するが、
// killをOS任せにせず明示的に落とす）。そこでElectrobunのウィンドウ終了・アプリ終了イベントからも
// cleanup()を呼ぶ。will-closeはウィンドウを閉じる直前（ネイティブのcloseWindowより前）、
// before-quitはCmd+Q等のアプリ終了要求で発火する。cleanup()は冪等なので複数経路から
// 呼ばれても問題ない
function onExit() {
  saveWindowFrameNow();
  cleanup();
}

mainWindow.on("will-close", () => onExit());
mainWindow.on("close", () => onExit());
Electrobun.events.on("before-quit", () => onExit());

// WindowsではmainWindow.activate()（ネイティブのactivateWindow）がwebviewのOSキーボードフォーカスを
// 壊し、物理クリックまでキー入力が一切届かなくなる（docs/known-issues/windows-popup-activatewindow-focus-loss.md）。
// 加えてウィンドウ生成時点ではWebView2のコントローラがまだ無く、生成時のactivateではweb contentへ
// フォーカスが渡らない。showWindow(activate:true)ならネイティブ側がFocusActiveView()＝
// MoveFocus(PROGRAMMATIC)まで行うため、webviewの準備ができたready受信時に一度だけ呼ぶ
if (process.platform !== "win32") {
  mainWindow.activate();
}

let webviewFocused = false;

/** 起動直後に一度だけ、webviewの中身へOSキーボードフォーカスを渡す（readyは再送されうるので1回だけ） */
function focusWebviewOnce(): void {
  if (webviewFocused) return;
  webviewFocused = true;
  if (process.platform !== "win32") return;
  mainWindow.show();
}

const configWatcher = watchConfigFile(configFilePath(), () => {
  void handleConfigFileChanged();
});

console.log("niwaterm started");
