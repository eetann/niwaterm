import { ApplicationMenu, BrowserView, BrowserWindow, type RPCSchema } from "electrobun/bun";
import { GhosttyTerminal } from "./ghostty";
import { Pty } from "./pty";

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
      render: {
        html: string;
        cursorX: number;
        cursorY: number;
        cursorVisible: boolean;
      };
    };
  }>;
};

let cols = 80;
let rows = 24;

const term = new GhosttyTerminal(cols, rows);

const shell = new Pty({ cols, rows });

// DSR等のクエリ応答（ESC[6n など）をPTYへ書き戻す
term.onWritePty((data) => {
  shell.write(data);
});

// OSC 52によるクリップボード書き込みをシステムクリップボードへ流す
term.onClipboardWrite((data) => {
  const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
  proc.stdin.write(data);
  proc.stdin.end();
});

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
  const cursor = term.cursor();
  rpcSend.render({
    html: term.dumpHtml(),
    cursorX: cursor.x,
    cursorY: cursor.y,
    cursorVisible: cursor.visible,
  });
}

shell.onData((data) => {
  term.write(data);
  scheduleRender();
});

shell.onExit((exitCode) => {
  console.log(`shell exited with code ${exitCode}`);
  cleanup();
  process.exit(0);
});

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    shell.kill();
  } catch {}
  term.free();
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
        shell.write(data);
      },
      paste: ({ data }: { data: string }) => {
        shell.write(term.encodePaste(data));
      },
      resize: (p: { cols: number; rows: number; cellWidth: number; cellHeight: number }) => {
        if (p.cols === cols && p.rows === rows) return;
        if (p.cols <= 0 || p.rows <= 0) return;
        cols = p.cols;
        rows = p.rows;
        term.resize(cols, rows, p.cellWidth, p.cellHeight);
        shell.resize(cols, rows);
        scheduleRender();
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
