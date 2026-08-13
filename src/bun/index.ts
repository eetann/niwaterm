import { ApplicationMenu, BrowserView, BrowserWindow, type RPCSchema } from "electrobun/bun";
import type {
  KeybindingsConfig,
  ResolvedAppearanceConfig,
  ResolvedBrowserConfig,
  ResolvedCustomViewConfig,
  ShellProfile,
} from "@niwaterm/config";
import { createBrowserBridge } from "./browser-bridge";
import { captureUrlScreenshot } from "./browser-screenshot";
import { readClipboardText, writeClipboardText } from "./clipboard";
import { configFilePath, loadAndResolveConfig } from "./config";
import { watchConfigFile } from "./config-watcher";
import { createIpcServer, ipcSocketPath, type IpcServer } from "./ipc-server";
import { loadPersistedState, persistedFilePath, savePersistedState } from "./persistence";
import { detectShellProfiles, resolveShellProfileCommand } from "./shell-profiles";
import type { SplitOrientation, TabId, TileId } from "./tile-layout";
import { createWorkspaceManager, type AppRenderState, type WorkspaceId } from "./workspace-manager";

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
      copySelection: { text: string };
      pasteFromClipboard: { tabId: TabId };
      resize: {
        tabId: TabId;
        cols: number;
        rows: number;
        cellWidth: number;
        cellHeight: number;
      };
      splitTile: { tileId: TileId; orientation: SplitOrientation };
      newTab: { tileId: TileId; shellProfileId?: string };
      newBrowserTab: { tileId: TileId; url?: string };
      newCustomViewTab: { tileId: TileId };
      switchTab: { tileId: TileId; tabId: TabId };
      closeTab: { tileId: TileId; tabId: TabId };
      focusTile: { tileId: TileId };
      focusDirection: { direction: "up" | "down" | "left" | "right" };
      resizeSplit: { splitId: TileId; ratio: number };
      newWorkspace: {};
      switchWorkspace: { workspaceId: WorkspaceId };
      closeWorkspace: { workspaceId: WorkspaceId };
      renameTab: { tabId: TabId; name: string };
      renameTile: { tileId: TileId; name: string };
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
  const rpcSend = (mainWindow.webview.rpc as any)?.send;
  if (!rpcSend) return;
  const snap = workspaceManager.snapshot();
  mainWindow.setTitle(
    snap.workspaceIds.length === 1
      ? "niwaterm"
      : `niwaterm — Workspace ${snap.workspaceIds.indexOf(snap.activeWorkspaceId) + 1}/${snap.workspaceIds.length}`,
  );
  rpcSend.render(snap);
}

function sendConfig() {
  const rpcSend = (mainWindow.webview.rpc as any)?.send;
  if (!rpcSend) return;
  rpcSend.config({ keybindings, appearance, customView, shellProfiles });
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
}

let keybindings: KeybindingsConfig;
let appearance: ResolvedAppearanceConfig;
let browser: ResolvedBrowserConfig;
let customView: ResolvedCustomViewConfig | null;
let defaultShell: string | undefined;
let shellProfiles: ShellProfile[];

// WSLディストロの増減は稀なイベントのため起動時に1回だけ検出し、ホットリロードのたびには
// wsl.exeを呼び直さない（アプリ再起動で反映されれば十分という判断）
const detectedShellProfiles = await detectShellProfiles();

async function refreshConfig(): Promise<void> {
  ({ keybindings, appearance, browser, customView, defaultShell, shellProfiles } =
    await loadAndResolveConfig(configFilePath(), detectedShellProfiles));
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

const restoreFrom = await loadPersistedState(persistedFilePath());

const workspaceManager = createWorkspaceManager({
  initialCols: 80,
  initialRows: 24,
  onDirty,
  restoreFrom,
  getDefaultShell: () => defaultShell,
  onAllWorkspacesClosed: () => {
    console.log("all workspaces closed, exiting");
    cleanup();
    process.exit(0);
  },
});

try {
  ipcServer = await createIpcServer(
    ipcSocketPath(),
    workspaceManager,
    () => customView,
    () => mainWindow.activate(),
    createBrowserBridge(() => rpc),
    captureUrlScreenshot,
    () => shellProfiles,
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
      copySelection: ({ text }: { text: string }) => {
        writeClipboardText(text);
      },
      pasteFromClipboard: ({ tabId }: { tabId: TabId }) => {
        readClipboardText().then((text) => {
          if (text) workspaceManager.handlePaste(tabId, text);
        });
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
      newTab: ({ tileId, shellProfileId }: { tileId: TileId; shellProfileId?: string }) => {
        const resolved = resolveShellProfileCommand(shellProfiles, shellProfileId);
        if (!resolved.ok) {
          console.log(`[bun] ${resolved.error}`);
          return;
        }
        workspaceManager.newTab(tileId, resolved.command);
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
      switchTab: ({ tileId, tabId }: { tileId: TileId; tabId: TabId }) => {
        workspaceManager.switchTab(tileId, tabId);
      },
      closeTab: ({ tileId, tabId }: { tileId: TileId; tabId: TabId }) => {
        workspaceManager.closeTab(tileId, tabId);
      },
      focusTile: ({ tileId }: { tileId: TileId }) => {
        workspaceManager.focusTile(tileId);
      },
      focusDirection: ({ direction }: { direction: "up" | "down" | "left" | "right" }) => {
        workspaceManager.focusDirection(direction);
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
      renameTab: ({ tabId, name }: { tabId: TabId; name: string }) => {
        workspaceManager.setTabName(tabId, name);
      },
      renameTile: ({ tileId, name }: { tileId: TileId; name: string }) => {
        workspaceManager.setTileName(tileId, name);
      },
    },
  },
});

const mainWindow = new BrowserWindow({
  title: "niwaterm",
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
