// CLI(niwaterm ping等)からの接続を受け付けるunix socket IPCサーバー。
// Electrobunのアプリコードは他のネイティブモジュール同様Bun Worker内で動くため、
// Bun.serveのunixオプションがWorker内でも動作することはsmoke testで実機確認済み。

import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { appSupportDir } from "./app-paths";
import { tmuxKeysToBytes } from "./tmux-keys";
import type { WorkspaceManager } from "./workspace-manager";

export function ipcSocketPath(): string {
  return join(appSupportDir(), "niwaterm.sock");
}

export interface IpcServer {
  close(): void;
}

interface SendKeysRequestBody {
  tabId: string;
  keys: string[];
}

function parseSendKeysBody(body: unknown): SendKeysRequestBody | null {
  const b = body as { tabId?: unknown; keys?: unknown };
  if (typeof b.tabId !== "string" || b.tabId.length === 0) return null;
  if (!Array.isArray(b.keys) || b.keys.length === 0) return null;
  if (!b.keys.every((k) => typeof k === "string")) return null;
  return { tabId: b.tabId, keys: b.keys };
}

function buildApp(workspaceManager: WorkspaceManager) {
  const app = new Hono();

  app.get("/ping", (c) => c.json({ ok: true, pid: process.pid }));

  app.get("/list", (c) => c.json({ workspaces: workspaceManager.listWorkspaces() }));

  app.post("/send-keys", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" }, 400);
    }
    const parsed = parseSendKeysBody(body);
    if (!parsed) {
      return c.json({ ok: false, error: "expected { tabId: string, keys: string[] }" }, 400);
    }
    if (!workspaceManager.hasTab(parsed.tabId)) {
      return c.json({ ok: false, error: `tab not found: ${parsed.tabId}` }, 404);
    }
    workspaceManager.handleInput(parsed.tabId, tmuxKeysToBytes(parsed.keys));
    return c.json({ ok: true });
  });

  return app;
}

/** 直前のプロセスが生きているかを実際に繋ぎにいって判定する（生死不明を避けるため） */
async function isSocketLive(path: string): Promise<boolean> {
  try {
    const socket = await Bun.connect({ unix: path, socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

async function removeStaleSocket(path: string): Promise<void> {
  if (await isSocketLive(path)) {
    throw new Error(`socket ${path} is already in use by a live process`);
  }
  try {
    unlinkSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function createIpcServer(
  path: string,
  workspaceManager: WorkspaceManager,
): Promise<IpcServer> {
  await removeStaleSocket(path);
  const app = buildApp(workspaceManager);
  const server = Bun.serve({ unix: path, fetch: app.fetch });
  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      server.stop();
      try {
        unlinkSync(path);
      } catch {
        // すでに消えている等は無視
      }
    },
  };
}
