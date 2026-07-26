import { ApplicationMenu, BrowserView, BrowserWindow, type RPCSchema } from "electrobun/bun";
import { loadPersistedState, persistedFilePath, savePersistedState } from "./persistence";
import type { SplitOrientation, TabId, TileId } from "./tile-layout";
import { createWorkspaceManager, type AppRenderState, type WorkspaceId } from "./workspace-manager";

// メニューが無いとCmd+C/Cmd+V等のkey equivalentがWebViewに届かないため、標準メニューを設定する
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

export type NiwaRPC = {
  bun: RPCSchema<{
    requests: {};
    messages: {
      log: { msg: string };
      ready: {};
      input: { tabId: TabId; data: string };
      paste: { tabId: TabId; data: string };
      resize: {
        tabId: TabId;
        cols: number;
        rows: number;
        cellWidth: number;
        cellHeight: number;
      };
      splitTile: { tileId: TileId; orientation: SplitOrientation };
      newTab: { tileId: TileId };
      switchTab: { tileId: TileId; tabId: TabId };
      closeTab: { tileId: TileId; tabId: TabId };
      focusTile: { tileId: TileId };
      focusDirection: { direction: "up" | "down" | "left" | "right" };
      resizeSplit: { splitId: TileId; ratio: number };
      newWorkspace: {};
      switchWorkspace: { workspaceId: WorkspaceId };
      closeWorkspace: { workspaceId: WorkspaceId };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      render: AppRenderState;
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

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  workspaceManager.dispose();
}

const restoreFrom = await loadPersistedState(persistedFilePath());

const workspaceManager = createWorkspaceManager({
  initialCols: 80,
  initialRows: 24,
  onDirty,
  restoreFrom,
  onAllWorkspacesClosed: () => {
    console.log("all workspaces closed, exiting");
    cleanup();
    process.exit(0);
  },
});

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
  maxRequestTime: 5000,
  handlers: {
    requests: {},
    messages: {
      log: ({ msg }: { msg: string }) => {
        console.log(`[view] ${msg}`);
      },
      ready: () => {
        scheduleRender();
      },
      input: ({ tabId, data }: { tabId: TabId; data: string }) => {
        workspaceManager.handleInput(tabId, data);
      },
      paste: ({ tabId, data }: { tabId: TabId; data: string }) => {
        workspaceManager.handlePaste(tabId, data);
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
      newTab: ({ tileId }: { tileId: TileId }) => {
        workspaceManager.newTab(tileId);
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

console.log("niwaterm started");
