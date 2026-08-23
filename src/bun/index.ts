import { ApplicationMenu, BrowserView, BrowserWindow, type RPCSchema, Utils } from "electrobun/bun";
import { APP_VARIANT } from "./app-variant.generated";
import type {
  KeybindingsConfig,
  LayoutsConfig,
  ResolvedAppearanceConfig,
  ResolvedBrowserConfig,
  ResolvedCustomViewConfig,
  ShellProfile,
} from "@niwaterm/config";
import { createBrowserBridge } from "./browser-bridge";
import { captureUrlScreenshot } from "./browser-screenshot";
import { readClipboardText, writeClipboardText } from "./clipboard";
import { cleanupConfigImportDir, configFilePath, loadAndResolveConfig } from "./config";
import { watchConfigFile } from "./config-watcher";
import { createIpcServer, ipcSocketPath, type IpcServer } from "./ipc-server";
import { DEFAULT_RESIZE_AMOUNT } from "./niwa-api";
import { isAllowedLinkUrl } from "./open-link";
import { loadPersistedState, persistedFilePath, savePersistedState } from "./persistence";
import { detectShellProfiles, resolveShellProfileCommand } from "./shell-profiles";
import type { SplitOrientation, TabId, TileId } from "./tile-layout";
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
    requests: {};
    messages: {
      log: { msg: string };
      ready: {};
      input: { tabId: TabId; data: string };
      paste: { tabId: TabId; data: string };
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
      closeWorkspace: { workspaceId: WorkspaceId };
      newBoard: { workspaceId: WorkspaceId; cwd?: string };
      switchBoard: { boardId: BoardId };
      closeBoard: { boardId: BoardId };
      renameTab: { tabId: TabId; name: string };
      renameTile: { tileId: TileId; name: string };
      renameWorkspace: { workspaceId: WorkspaceId; name: string };
      renameBoard: { boardId: BoardId; name: string };
      /** keybindingsのBindingTargetがkind:"custom"の場合に発火する。handlerIdはniwa-api.tsのhandlerRegistryのキー */
      runKeybindHandler: { handlerId: string };
      /** reload-configキーバインド・コマンドパレットからの手動リロード要求。ファイル監視での自動リロードと同じhandleConfigFileChangedを呼ぶ */
      reloadConfig: {};
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
        customView: ResolvedCustomViewConfig | null;
        shellProfiles: ShellProfile[];
      };
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
  const snap = workspaceManager.snapshot();
  mainWindow.setTitle(
    snap.workspaceIds.length === 1
      ? APP_VARIANT
      : `${APP_VARIANT} — Workspace ${snap.workspaceIds.indexOf(snap.activeWorkspaceId) + 1}/${snap.workspaceIds.length}`,
  );
  rpcSend.render(snap);
}

function sendConfig() {
  // render()と同じ理由でmainWindow構築前に呼ばれうるためガードする
  if (!mainWindow) return;
  const rpcSend = (mainWindow.webview.rpc as any)?.send;
  if (!rpcSend) return;
  rpcSend.config({ keybindings, appearance: effectiveAppearance(), customView, shellProfiles });
}

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
  workspaceManager.dispose();
  ipcServer?.close();
  cleanupConfigImportDir();
}

let keybindings: KeybindingsConfig;
let appearance: ResolvedAppearanceConfig;
let browser: ResolvedBrowserConfig;
let customView: ResolvedCustomViewConfig | null;
let defaultShell: string | undefined;
let shellProfiles: ShellProfile[];
let layouts: LayoutsConfig;
let workspaceDefaultCwd: string | undefined;
let runKeybindHandler: (id: string) => Promise<void>;

// WSLディストロの増減は稀なイベントのため起動時に1回だけ検出し、ホットリロードのたびには
// wsl.exeを呼び直さない（アプリ再起動で反映されれば十分という判断）
const detectedShellProfiles = await detectShellProfiles();

const restoreFrom = await loadPersistedState(persistedFilePath());

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
  onAllWorkspacesClosed: () => {
    console.log("all workspaces closed, exiting");
    cleanup();
    process.exit(0);
  },
});

async function refreshConfig(): Promise<void> {
  ({
    keybindings,
    appearance,
    browser,
    customView,
    defaultShell,
    shellProfiles,
    layouts,
    workspaceDefaultCwd,
    runKeybindHandler,
  } = await loadAndResolveConfig(configFilePath(), workspaceManager, detectedShellProfiles));
}

await refreshConfig();

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
    requests: {},
    messages: {
      log: ({ msg }: { msg: string }) => {
        console.log(`[view] ${msg}`);
      },
      ready: () => {
        scheduleRender();
        sendConfig();
      },
      input: ({ tabId, data }: { tabId: TabId; data: string }) => {
        workspaceManager.handleInput(tabId, data);
      },
      paste: ({ tabId, data }: { tabId: TabId; data: string }) => {
        workspaceManager.handlePaste(tabId, data);
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
      closeWorkspace: ({ workspaceId }: { workspaceId: WorkspaceId }) => {
        workspaceManager.closeWorkspace(workspaceId);
      },
      newBoard: ({ workspaceId, cwd }: { workspaceId: WorkspaceId; cwd?: string }) => {
        workspaceManager.newBoard(workspaceId, cwd);
      },
      switchBoard: ({ boardId }: { boardId: BoardId }) => {
        workspaceManager.switchBoard(boardId);
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
      runKeybindHandler: ({ handlerId }: { handlerId: string }) => {
        runKeybindHandler(handlerId).catch((err: unknown) => {
          console.log(`[bun] keybind handler error: ${String(err)}`);
        });
      },
      reloadConfig: () => {
        handleConfigFileChanged().catch((err: unknown) => {
          console.log(`[bun] manual config reload error: ${String(err)}`);
        });
      },
    },
  },
});

const mainWindow = new BrowserWindow({
  // 開発中ビルド(niwaterm-dev)と普段遣いビルド(niwaterm-daily-dev)を同時に起動した際に
  // タイトルバーで見分けられるよう、実際のアプリ名をそのまま使う
  title: APP_VARIANT,
  url: "views://mainview/index.html",
  frame: {
    width: 900,
    height: 600,
    x: 200,
    y: 200,
  },
  rpc,
});

mainWindow.activate();

const configWatcher = watchConfigFile(configFilePath(), () => {
  void handleConfigFileChanged();
});

console.log("niwaterm started");
