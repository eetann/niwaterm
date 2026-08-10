// niwatermアプリのIPCサーバー(unix socket)への接続。
// ソケットパスの解決ロジックはsrc/bun/app-paths.ts・ipc-server.tsと同じ内容だが、
// このパッケージは別ワークスペースパッケージでsrc/bunをimportできないため、意図的に重複させている。
// 片方だけ変更すると接続できなくなるため、変更時は必ず両方を揃えること。

import { homedir } from "node:os";
import { join } from "node:path";

function appSupportDir(): string {
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "niwaterm");
  }
  return join(homedir(), "Library", "Application Support", "niwaterm");
}

export function ipcSocketPath(): string {
  return join(appSupportDir(), "niwaterm.sock");
}

/**
 * unix socketへの接続失敗はソケット未存在・プロセス不在・不正ファイルいずれも
 * err.code === "FailedToOpenSocket" になる（Bunのfetch実装、実機確認済み）。
 * デフォルトの文言("Was there a typo in the url or port?")はunix socket用途では
 * わかりにくいため、原因（アプリ未起動の可能性）を示す文言に差し替える。
 */
function describeError(err: unknown): string {
  if (err instanceof Error && (err as { code?: string }).code === "FailedToOpenSocket") {
    return "アプリが起動していない可能性があります。`bun run start`で起動してから再実行してください";
  }
  return String(err);
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
    return { ok: false, error: describeError(err) };
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
    return { ok: false, error: describeError(err) };
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
    return { ok: false, error: describeError(err) };
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
    return { ok: false, error: describeError(err) };
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
    return { ok: false, error: describeError(err) };
  }
}

export type BrowserNavigateResult = { ok: true } | { ok: false; error: string };

/** ブラウザタブのURLを遷移する（Playwrightのpage.goto()相当） */
export function browserNavigate(
  socketPath: string,
  tabId: TabId,
  url: string,
): Promise<BrowserNavigateResult> {
  return postJson(socketPath, "/browser-navigate", { tabId, url });
}

export type BrowserGetTextResult = { ok: true; text: string } | { ok: false; error: string };

/** ブラウザタブの表示内容をプレーンテキストで取得する */
export async function browserGetText(
  socketPath: string,
  tabId: TabId,
): Promise<BrowserGetTextResult> {
  try {
    const res = await fetch(
      `http://localhost/browser-get-text?tabId=${encodeURIComponent(tabId)}`,
      { unix: socketPath },
    );
    const body = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
    if (res.ok && typeof body?.text === "string") return { ok: true, text: body.text };
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

export type BrowserGetHtmlResult = { ok: true; html: string } | { ok: false; error: string };

/** ブラウザタブのHTMLを取得する */
export async function browserGetHtml(
  socketPath: string,
  tabId: TabId,
): Promise<BrowserGetHtmlResult> {
  try {
    const res = await fetch(
      `http://localhost/browser-get-html?tabId=${encodeURIComponent(tabId)}`,
      { unix: socketPath },
    );
    const body = (await res.json().catch(() => null)) as { html?: unknown; error?: unknown } | null;
    if (res.ok && typeof body?.html === "string") return { ok: true, html: body.html };
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

export type BrowserScreenshotResult = { ok: true; data: Uint8Array } | { ok: false; error: string };

/**
 * ブラウザタブの現在URLをheadless WebViewで別途開き直してスクリーンショット(PNG)を取得する。
 * 表示中タブとは別インスタンスのため「今見えている状態そのもの」ではなく
 * 「同じURLを新規に開いた場合の見た目」になる点に注意
 */
export async function browserScreenshot(
  socketPath: string,
  tabId: TabId,
): Promise<BrowserScreenshotResult> {
  try {
    const res = await fetch(
      `http://localhost/browser-screenshot?tabId=${encodeURIComponent(tabId)}`,
      { unix: socketPath },
    );
    if (res.ok) {
      const data = new Uint8Array(await res.arrayBuffer());
      return { ok: true, data };
    }
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

export type ShowTabResult =
  | { ok: true; workspaceId: string; tileId: TileId }
  | { ok: false; error: string };

/**
 * tabIdだけを指定して、所属ワークスペースへの切替・タイルフォーカス・タブアクティブ化・
 * ウィンドウ前面化をまとめて行う。AIがヘッドレスで操作したタブを人間が任意に目視確認するための
 * コマンド（switch-tab/focus-tileと違いワークスペース跨ぎ・ウィンドウ前面化まで面倒を見る）
 */
export function showTab(socketPath: string, tabId: TabId): Promise<ShowTabResult> {
  return postJson(socketPath, "/show-tab", { tabId });
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
    return { ok: false, error: describeError(err) };
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
    return { ok: false, error: describeError(err) };
  }
}
