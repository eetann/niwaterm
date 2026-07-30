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

export type TileId = string;
export type TabId = string;

export interface TileLeafSummary {
  kind: "leaf";
  id: TileId;
  tabIds: TabId[];
  activeTabId: TabId;
}

export interface TileSplitSummary {
  kind: "split";
  id: TileId;
  direction: "row" | "column";
  ratio: number;
  first: TileSummary;
  second: TileSummary;
}

export type TileSummary = TileLeafSummary | TileSplitSummary;

export interface WorkspaceListEntry {
  workspaceId: string;
  active: boolean;
  focusedTileId: TileId;
  layout: TileSummary;
}

export type ListResult =
  | { ok: true; workspaces: WorkspaceListEntry[] }
  | { ok: false; error: string };

export async function listWorkspaces(socketPath: string): Promise<ListResult> {
  try {
    const res = await fetch("http://localhost/list", { unix: socketPath });
    if (!res.ok) return { ok: false, error: `unexpected status ${res.status}` };
    const body = (await res.json()) as { workspaces?: unknown };
    if (!Array.isArray(body.workspaces)) return { ok: false, error: "malformed response" };
    return { ok: true, workspaces: body.workspaces as WorkspaceListEntry[] };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type SendKeysResult = { ok: true } | { ok: false; error: string };

export async function sendKeys(
  socketPath: string,
  tabId: string,
  keys: string[],
): Promise<SendKeysResult> {
  try {
    const res = await fetch("http://localhost/send-keys", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId, keys }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
