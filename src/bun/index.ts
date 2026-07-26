import { ApplicationMenu, BrowserView, BrowserWindow, type RPCSchema } from "electrobun/bun";
import type { SplitOrientation, TabId, TileId } from "./tile-layout";
import { createWorkspace, type WorkspaceRenderState } from "./workspace";

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
      closeTile: { tileId: TileId };
      focusTile: { tileId: TileId };
      focusDirection: { direction: "up" | "down" | "left" | "right" };
      resizeSplit: { splitId: TileId; ratio: number };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      render: WorkspaceRenderState;
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
  rpcSend.render(workspace.snapshot());
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  workspace.dispose();
}

const workspace = createWorkspace({
  initialCols: 80,
  initialRows: 24,
  onDirty: () => scheduleRender(),
  onAllTabsClosed: () => {
    console.log("all tabs closed, exiting");
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
        workspace.handleInput(tabId, data);
      },
      paste: ({ tabId, data }: { tabId: TabId; data: string }) => {
        workspace.handlePaste(tabId, data);
      },
      resize: (p: {
        tabId: TabId;
        cols: number;
        rows: number;
        cellWidth: number;
        cellHeight: number;
      }) => {
        workspace.handleResize(p.tabId, p.cols, p.rows, p.cellWidth, p.cellHeight);
      },
      splitTile: ({ tileId, orientation }: { tileId: TileId; orientation: SplitOrientation }) => {
        workspace.splitTile(tileId, orientation);
      },
      closeTile: ({ tileId }: { tileId: TileId }) => {
        workspace.closeTile(tileId);
      },
      focusTile: ({ tileId }: { tileId: TileId }) => {
        workspace.focusTile(tileId);
      },
      focusDirection: ({ direction }: { direction: "up" | "down" | "left" | "right" }) => {
        workspace.focusDirection(direction);
      },
      resizeSplit: ({ splitId, ratio }: { splitId: TileId; ratio: number }) => {
        workspace.resizeSplit(splitId, ratio);
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
