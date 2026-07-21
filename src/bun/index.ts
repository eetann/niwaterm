import { ApplicationMenu, BrowserView, BrowserWindow, type RPCSchema } from "electrobun/bun";
import { createTerminalSession, type TerminalRenderState } from "./terminal-session";

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
      input: { data: string };
      paste: { data: string };
      resize: {
        cols: number;
        rows: number;
        cellWidth: number;
        cellHeight: number;
      };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      render: TerminalRenderState;
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
  rpcSend.render(session.renderState());
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  session.dispose();
}

const session = createTerminalSession({
  cols: 80,
  rows: 24,
  onOutput: () => scheduleRender(),
  onExit: (code) => {
    console.log(`shell exited with code ${code}`);
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
      input: ({ data }: { data: string }) => {
        session.write(data);
      },
      paste: ({ data }: { data: string }) => {
        session.paste(data);
      },
      resize: (p: { cols: number; rows: number; cellWidth: number; cellHeight: number }) => {
        if (session.resize(p.cols, p.rows, p.cellWidth, p.cellHeight)) {
          scheduleRender();
        }
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
