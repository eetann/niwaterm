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

export type SplitOrientation = "horizontal" | "vertical";

/** POST（`{ok:true}`系）呼び出しの共通処理。成功時はbodyをそのまま返す */
async function postJson<T extends { ok: true }>(
  socketPath: string,
  path: string,
  body: unknown,
): Promise<T | { ok: false; error: string }> {
  try {
    const res = await fetch(`http://localhost${path}`, {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => null)) as (T | { error?: unknown }) | null;
    if (res.ok && parsed) return parsed as T;
    const error =
      parsed && typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type SplitTileResult =
  | { ok: true; tileId: TileId; tabId: TabId }
  | { ok: false; error: string };

export function splitTile(
  socketPath: string,
  tileId: TileId,
  orientation: SplitOrientation,
): Promise<SplitTileResult> {
  return postJson(socketPath, "/split-tile", { tileId, orientation });
}

export type NewTabResult = { ok: true; tabId: TabId } | { ok: false; error: string };

export function newTab(
  socketPath: string,
  tileId: TileId,
  url?: string,
  customView?: boolean,
): Promise<NewTabResult> {
  const body: { tileId: TileId; url?: string; customView?: boolean } = { tileId };
  if (url !== undefined) body.url = url;
  if (customView !== undefined) body.customView = customView;
  return postJson(socketPath, "/new-tab", body);
}

export type SwitchTabResult = { ok: true } | { ok: false; error: string };

export function switchTab(
  socketPath: string,
  tileId: TileId,
  tabId: TabId,
): Promise<SwitchTabResult> {
  return postJson(socketPath, "/switch-tab", { tileId, tabId });
}

export type CloseTabResult = { ok: true } | { ok: false; error: string };

export function closeTab(
  socketPath: string,
  tileId: TileId,
  tabId: TabId,
): Promise<CloseTabResult> {
  return postJson(socketPath, "/close-tab", { tileId, tabId });
}

export type FocusTileResult = { ok: true } | { ok: false; error: string };

export function focusTile(socketPath: string, tileId: TileId): Promise<FocusTileResult> {
  return postJson(socketPath, "/focus-tile", { tileId });
}

export type CaptureTabResult = { ok: true; text: string } | { ok: false; error: string };

export async function captureTab(socketPath: string, tabId: TabId): Promise<CaptureTabResult> {
  try {
    const res = await fetch(`http://localhost/capture-tab?tabId=${encodeURIComponent(tabId)}`, {
      unix: socketPath,
    });
    const body = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
    if (res.ok && typeof body?.text === "string") return { ok: true, text: body.text };
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type SetTileVarResult = { ok: true } | { ok: false; error: string };

export function setTileVar(
  socketPath: string,
  tileId: TileId,
  key: string,
  value: string,
): Promise<SetTileVarResult> {
  return postJson(socketPath, "/set-var", { tileId, key, value });
}

export type GetTileVarResult = { ok: true; value: string } | { ok: false; error: string };

export async function getTileVar(
  socketPath: string,
  tileId: TileId,
  key: string,
): Promise<GetTileVarResult> {
  try {
    const res = await fetch(
      `http://localhost/get-var?tileId=${encodeURIComponent(tileId)}&key=${encodeURIComponent(key)}`,
      { unix: socketPath },
    );
    const body = (await res.json().catch(() => null)) as {
      value?: unknown;
      error?: unknown;
    } | null;
    if (res.ok && typeof body?.value === "string") return { ok: true, value: body.value };
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type ListTileVarsResult =
  | { ok: true; vars: Record<string, string> }
  | { ok: false; error: string };

export async function listTileVars(
  socketPath: string,
  tileId: TileId,
): Promise<ListTileVarsResult> {
  try {
    const res = await fetch(`http://localhost/list-vars?tileId=${encodeURIComponent(tileId)}`, {
      unix: socketPath,
    });
    const body = (await res.json().catch(() => null)) as { vars?: unknown; error?: unknown } | null;
    if (res.ok && body?.vars && typeof body.vars === "object") {
      return { ok: true, vars: body.vars as Record<string, string> };
    }
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
