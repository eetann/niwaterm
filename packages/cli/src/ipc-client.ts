// niwatermアプリのIPCサーバーへの接続。
// ソケットパスの解決ロジックはsrc/bun/app-paths.ts・ipc-server.tsと同じ内容だが、
// このパッケージは別ワークスペースパッケージでsrc/bunをimportできないため、意図的に重複させている。
// 片方だけ変更すると接続できなくなるため、変更時は必ず両方を揃えること。
//
// WSL(NixOS等)からは、Windows側アプリのUnix domain socketへ直接接続できない
// （9p/drvfs越しにソケットファイルとして扱えず、Linux側から見るとただの空のregular fileに
// なるため。実機検証済み）。そのためWSL上ではsrc/bun/ipc-server.tsが追加でlistenしている
// TCPブリッジへ接続する。ブリッジのポート番号（WSL_BRIDGE_PORT）もipc-server.tsと
// 意図的に重複させている。

import { readFileSync } from "node:fs";
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

const WSL_BRIDGE_PORT = 47831;

/** /proc/versionに"microsoft"を含むかどうかでWSL上かを判定する（is-wsl等でも使われる標準的な手法） */
function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

/**
 * WSL2のデフォルトゲートウェイ（=Windowsホスト側のWSL用仮想アダプタのIP）を
 * /proc/net/routeから解決する。このIPはWSL VM再起動のたびに変わりうるため、
 * キャッシュせず毎回動的に読み直す。取得できない場合はnullを返す
 */
function wslDefaultGateway(): string | null {
  try {
    const route = readFileSync("/proc/net/route", "utf8");
    for (const line of route.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      const destination = fields[1];
      const gatewayHex = fields[2];
      if (destination !== "00000000" || !gatewayHex || gatewayHex.length !== 8) continue;
      const bytes = gatewayHex.match(/../g);
      if (!bytes) continue;
      return bytes
        .reverse()
        .map((byte) => Number.parseInt(byte, 16))
        .join(".");
    }
    return null;
  } catch {
    return null;
  }
}

export type IpcEndpoint =
  | { kind: "unix"; path: string }
  | { kind: "tcp"; host: string; port: number };

/**
 * 接続先を解決する。WSL上ではUnix domain socketへ接続できないため、
 * デフォルトゲートウェイが解決できればTCPブリッジ（WSL_BRIDGE_PORT）を使う。
 * それ以外（macOS・Windows実機）は従来通りUnix domain socketを使う
 */
export function resolveIpcEndpoint(): IpcEndpoint {
  if (isWsl()) {
    const gateway = wslDefaultGateway();
    if (gateway) return { kind: "tcp", host: gateway, port: WSL_BRIDGE_PORT };
  }
  return { kind: "unix", path: ipcSocketPath() };
}

function ipcUrl(endpoint: IpcEndpoint, path: string): string {
  if (endpoint.kind === "tcp") return `http://${endpoint.host}:${endpoint.port}${path}`;
  return `http://localhost${path}`;
}

/** BunのfetchはWeb標準のRequestInitにない`unix`を追加でサポートするため、その分だけ型を広げる */
function ipcFetchInit(
  endpoint: IpcEndpoint,
  init: RequestInit = {},
): RequestInit & { unix?: string } {
  if (endpoint.kind === "unix") return { ...init, unix: endpoint.path };
  return init;
}

/**
 * 接続失敗の原因をわかりやすい文言に差し替える。
 * unix socket: ソケット未存在・プロセス不在・不正ファイルいずれも
 * err.code === "FailedToOpenSocket" になる（Bunのfetch実装、実機確認済み）。
 * デフォルトの文言("Was there a typo in the url or port?")はunix socket用途では
 * わかりにくいため、原因（アプリ未起動の可能性）を示す文言に差し替える。
 * tcp（WSLブリッジ）: 接続拒否・タイムアウトいずれもWindows側アプリ未起動、または
 * 古いバージョンでTCPブリッジ自体が存在しない可能性を示す文言にする。
 */
function describeError(endpoint: IpcEndpoint, err: unknown): string {
  if (endpoint.kind === "unix") {
    if (err instanceof Error && (err as { code?: string }).code === "FailedToOpenSocket") {
      return "アプリが起動していない可能性があります。`bun run start`で起動してから再実行してください";
    }
    return String(err);
  }
  return `WSLからWindows側niwatermアプリ(${endpoint.host}:${endpoint.port})へ接続できませんでした。Windows側でアプリが起動しているか確認してください（${String(err)}）`;
}

export type PingResult = { ok: true; pid: number } | { ok: false; error: string };

export async function pingNiwaterm(endpoint: IpcEndpoint): Promise<PingResult> {
  try {
    const res = await fetch(ipcUrl(endpoint, "/ping"), ipcFetchInit(endpoint));
    if (!res.ok) return { ok: false, error: `unexpected status ${res.status}` };
    const body = (await res.json()) as { pid?: unknown };
    if (typeof body.pid !== "number") return { ok: false, error: "malformed response" };
    return { ok: true, pid: body.pid };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
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

export async function listWorkspaces(endpoint: IpcEndpoint): Promise<ListResult> {
  try {
    const res = await fetch(ipcUrl(endpoint, "/list"), ipcFetchInit(endpoint));
    if (!res.ok) return { ok: false, error: `unexpected status ${res.status}` };
    const body = (await res.json()) as { workspaces?: unknown };
    if (!Array.isArray(body.workspaces)) return { ok: false, error: "malformed response" };
    return { ok: true, workspaces: body.workspaces as WorkspaceListEntry[] };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}

export type SendKeysResult = { ok: true } | { ok: false; error: string };

export async function sendKeys(
  endpoint: IpcEndpoint,
  tabId: string,
  keys: string[],
): Promise<SendKeysResult> {
  try {
    const res = await fetch(
      ipcUrl(endpoint, "/send-keys"),
      ipcFetchInit(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tabId, keys }),
      }),
    );
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}

export type SplitOrientation = "horizontal" | "vertical";

/** POST（`{ok:true}`系）呼び出しの共通処理。成功時はbodyをそのまま返す */
async function postJson<T extends { ok: true }>(
  endpoint: IpcEndpoint,
  path: string,
  body: unknown,
): Promise<T | { ok: false; error: string }> {
  try {
    const res = await fetch(
      ipcUrl(endpoint, path),
      ipcFetchInit(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const parsed = (await res.json().catch(() => null)) as (T | { error?: unknown }) | null;
    if (res.ok && parsed) return parsed as T;
    const error =
      parsed && typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}

export type SplitTileResult =
  | { ok: true; tileId: TileId; tabId: TabId }
  | { ok: false; error: string };

export function splitTile(
  endpoint: IpcEndpoint,
  tileId: TileId,
  orientation: SplitOrientation,
): Promise<SplitTileResult> {
  return postJson(endpoint, "/split-tile", { tileId, orientation });
}

export type NewTabResult = { ok: true; tabId: TabId } | { ok: false; error: string };

export function newTab(
  endpoint: IpcEndpoint,
  tileId: TileId,
  url?: string,
  customView?: boolean,
  shellProfileId?: string,
  cwd?: string,
): Promise<NewTabResult> {
  const body: {
    tileId: TileId;
    url?: string;
    customView?: boolean;
    shellProfileId?: string;
    cwd?: string;
  } = { tileId };
  if (url !== undefined) body.url = url;
  if (customView !== undefined) body.customView = customView;
  if (shellProfileId !== undefined) body.shellProfileId = shellProfileId;
  if (cwd !== undefined) body.cwd = cwd;
  return postJson(endpoint, "/new-tab", body);
}

export type NewWorkspaceResult = { ok: true; workspaceId: string } | { ok: false; error: string };

export function newWorkspace(endpoint: IpcEndpoint): Promise<NewWorkspaceResult> {
  return postJson(endpoint, "/new-workspace", {});
}

export type SwitchWorkspaceResult = { ok: true } | { ok: false; error: string };

export function switchWorkspace(
  endpoint: IpcEndpoint,
  workspaceId: string,
): Promise<SwitchWorkspaceResult> {
  return postJson(endpoint, "/switch-workspace", { workspaceId });
}

export type CloseWorkspaceResult = { ok: true } | { ok: false; error: string };

export function closeWorkspace(
  endpoint: IpcEndpoint,
  workspaceId: string,
): Promise<CloseWorkspaceResult> {
  return postJson(endpoint, "/close-workspace", { workspaceId });
}

export interface ShellProfileEntry {
  id: string;
  name: string;
  command: string;
}

export type ListShellProfilesResult =
  | { ok: true; profiles: ShellProfileEntry[] }
  | { ok: false; error: string };

export async function listShellProfiles(endpoint: IpcEndpoint): Promise<ListShellProfilesResult> {
  try {
    const res = await fetch(ipcUrl(endpoint, "/shell-profiles"), ipcFetchInit(endpoint));
    const body = (await res.json().catch(() => null)) as {
      profiles?: unknown;
      error?: unknown;
    } | null;
    if (res.ok && Array.isArray(body?.profiles)) {
      return { ok: true, profiles: body.profiles as ShellProfileEntry[] };
    }
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}

export interface LayoutSummary {
  name: string;
  description?: string;
}

export type ListLayoutsResult =
  | { ok: true; layouts: LayoutSummary[] }
  | { ok: false; error: string };

export async function listLayouts(endpoint: IpcEndpoint): Promise<ListLayoutsResult> {
  try {
    const res = await fetch(ipcUrl(endpoint, "/layouts"), ipcFetchInit(endpoint));
    const body = (await res.json().catch(() => null)) as {
      layouts?: unknown;
      error?: unknown;
    } | null;
    if (res.ok && Array.isArray(body?.layouts)) {
      return { ok: true, layouts: body.layouts as LayoutSummary[] };
    }
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}

export type ApplyLayoutTarget = "new-workspace" | "replace";

export type ApplyLayoutResult = { ok: true; workspaceId: string } | { ok: false; error: string };

export function applyLayout(
  endpoint: IpcEndpoint,
  name: string,
  target: ApplyLayoutTarget,
  cwd?: string,
): Promise<ApplyLayoutResult> {
  const body: { name: string; target: ApplyLayoutTarget; cwd?: string } = { name, target };
  if (cwd !== undefined) body.cwd = cwd;
  return postJson(endpoint, "/apply-layout", body);
}

export type SwitchTabResult = { ok: true } | { ok: false; error: string };

export function switchTab(
  endpoint: IpcEndpoint,
  tileId: TileId,
  tabId: TabId,
): Promise<SwitchTabResult> {
  return postJson(endpoint, "/switch-tab", { tileId, tabId });
}

export type CloseTabResult = { ok: true } | { ok: false; error: string };

export function closeTab(
  endpoint: IpcEndpoint,
  tileId: TileId,
  tabId: TabId,
): Promise<CloseTabResult> {
  return postJson(endpoint, "/close-tab", { tileId, tabId });
}

export type FocusTileResult = { ok: true } | { ok: false; error: string };

export function focusTile(endpoint: IpcEndpoint, tileId: TileId): Promise<FocusTileResult> {
  return postJson(endpoint, "/focus-tile", { tileId });
}

export type CaptureTabResult = { ok: true; text: string } | { ok: false; error: string };

export async function captureTab(endpoint: IpcEndpoint, tabId: TabId): Promise<CaptureTabResult> {
  try {
    const res = await fetch(
      ipcUrl(endpoint, `/capture-tab?tabId=${encodeURIComponent(tabId)}`),
      ipcFetchInit(endpoint),
    );
    const body = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
    if (res.ok && typeof body?.text === "string") return { ok: true, text: body.text };
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}

export type BrowserNavigateResult = { ok: true } | { ok: false; error: string };

/** ブラウザタブのURLを遷移する（Playwrightのpage.goto()相当） */
export function browserNavigate(
  endpoint: IpcEndpoint,
  tabId: TabId,
  url: string,
): Promise<BrowserNavigateResult> {
  return postJson(endpoint, "/browser-navigate", { tabId, url });
}

export type BrowserGetTextResult = { ok: true; text: string } | { ok: false; error: string };

/** ブラウザタブの表示内容をプレーンテキストで取得する */
export async function browserGetText(
  endpoint: IpcEndpoint,
  tabId: TabId,
): Promise<BrowserGetTextResult> {
  try {
    const res = await fetch(
      ipcUrl(endpoint, `/browser-get-text?tabId=${encodeURIComponent(tabId)}`),
      ipcFetchInit(endpoint),
    );
    const body = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
    if (res.ok && typeof body?.text === "string") return { ok: true, text: body.text };
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}

export type BrowserGetHtmlResult = { ok: true; html: string } | { ok: false; error: string };

/** ブラウザタブのHTMLを取得する */
export async function browserGetHtml(
  endpoint: IpcEndpoint,
  tabId: TabId,
): Promise<BrowserGetHtmlResult> {
  try {
    const res = await fetch(
      ipcUrl(endpoint, `/browser-get-html?tabId=${encodeURIComponent(tabId)}`),
      ipcFetchInit(endpoint),
    );
    const body = (await res.json().catch(() => null)) as { html?: unknown; error?: unknown } | null;
    if (res.ok && typeof body?.html === "string") return { ok: true, html: body.html };
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}

export type BrowserScreenshotResult = { ok: true; data: Uint8Array } | { ok: false; error: string };

/**
 * ブラウザタブの現在URLをheadless WebViewで別途開き直してスクリーンショット(PNG)を取得する。
 * 表示中タブとは別インスタンスのため「今見えている状態そのもの」ではなく
 * 「同じURLを新規に開いた場合の見た目」になる点に注意
 */
export async function browserScreenshot(
  endpoint: IpcEndpoint,
  tabId: TabId,
): Promise<BrowserScreenshotResult> {
  try {
    const res = await fetch(
      ipcUrl(endpoint, `/browser-screenshot?tabId=${encodeURIComponent(tabId)}`),
      ipcFetchInit(endpoint),
    );
    if (res.ok) {
      const data = new Uint8Array(await res.arrayBuffer());
      return { ok: true, data };
    }
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
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
export function showTab(endpoint: IpcEndpoint, tabId: TabId): Promise<ShowTabResult> {
  return postJson(endpoint, "/show-tab", { tabId });
}

export type SetTabVarResult = { ok: true } | { ok: false; error: string };

export function setTabVar(
  endpoint: IpcEndpoint,
  tabId: TabId,
  key: string,
  value: string,
): Promise<SetTabVarResult> {
  return postJson(endpoint, "/set-var", { tabId, key, value });
}

export type GetTabVarResult = { ok: true; value: string } | { ok: false; error: string };

export async function getTabVar(
  endpoint: IpcEndpoint,
  tabId: TabId,
  key: string,
): Promise<GetTabVarResult> {
  try {
    const res = await fetch(
      ipcUrl(
        endpoint,
        `/get-var?tabId=${encodeURIComponent(tabId)}&key=${encodeURIComponent(key)}`,
      ),
      ipcFetchInit(endpoint),
    );
    const body = (await res.json().catch(() => null)) as {
      value?: unknown;
      error?: unknown;
    } | null;
    if (res.ok && typeof body?.value === "string") return { ok: true, value: body.value };
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}

export type ListTabVarsResult =
  | { ok: true; vars: Record<string, string> }
  | { ok: false; error: string };

export async function listTabVars(endpoint: IpcEndpoint, tabId: TabId): Promise<ListTabVarsResult> {
  try {
    const res = await fetch(
      ipcUrl(endpoint, `/list-vars?tabId=${encodeURIComponent(tabId)}`),
      ipcFetchInit(endpoint),
    );
    const body = (await res.json().catch(() => null)) as { vars?: unknown; error?: unknown } | null;
    if (res.ok && body?.vars && typeof body.vars === "object") {
      return { ok: true, vars: body.vars as Record<string, string> };
    }
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}
