// niwatermアプリのIPCサーバー(unix socket)への接続。
// ソケットパスの解決ロジックはsrc/bun/ipc-server.tsと同じ内容だが、
// このパッケージは別ワークスペースパッケージでsrc/bunをimportできないため、意図的に重複させている。

import { homedir } from "node:os";
import { join } from "node:path";

export function ipcSocketPath(): string {
  return join(homedir(), "Library", "Application Support", "niwaterm", "niwaterm.sock");
}

export type PingResult = { ok: true; pid: number } | { ok: false; error: string };

export async function pingNiwaterm(socketPath: string): Promise<PingResult> {
  try {
    const res = await fetch("http://localhost/ping", { unix: socketPath });
    if (!res.ok) return { ok: false, error: `unexpected status ${res.status}` };
    const body = (await res.json()) as { pid?: unknown };
    if (typeof body.pid !== "number") return { ok: false, error: "malformed response" };
    return { ok: true, pid: body.pid };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
