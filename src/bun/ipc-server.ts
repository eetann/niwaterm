// CLI(niwaterm ping等)からの接続を受け付けるunix socket IPCサーバー。
// Electrobunのアプリコードは他のネイティブモジュール同様Bun Worker内で動くため、
// Bun.serveのunixオプションがWorker内でも動作することはsmoke testで実機確認済み。

import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { appSupportDir } from "./app-paths";

export function ipcSocketPath(): string {
  return join(appSupportDir(), "niwaterm.sock");
}

export interface IpcServer {
  close(): void;
}

function buildApp() {
  const app = new Hono();
  app.get("/ping", (c) => c.json({ ok: true, pid: process.pid }));
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

export async function createIpcServer(path: string): Promise<IpcServer> {
  await removeStaleSocket(path);
  const app = buildApp();
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
