// CLI(niwaterm ping等)からの接続を受け付けるunix socket IPCサーバー。
// Electrobunのアプリコードは他のネイティブモジュール同様Bun Worker内で動くため、
// Bun.serveのunixオプションがWorker内でも動作することはsmoke testで実機確認済み。

import { unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { Hono, type Context } from "hono";
import type { LayoutsConfig, ResolvedCustomViewConfig, ShellProfile } from "@niwaterm/config";
import { appSupportDir } from "./app-paths";
import type { BrowserBridge } from "./browser-bridge";
import { captureUrlScreenshot, type ScreenshotResult } from "./browser-screenshot";
import { applyLayoutPreset, type ApplyLayoutTarget } from "./layout-apply";
import { resolveShellProfileCommand } from "./shell-profiles";
import type { SplitOrientation } from "./tile-layout";
import { tmuxKeysToBytes } from "./tmux-keys";
import type { WorkspaceManager } from "./workspace-manager";

const UNAVAILABLE_BROWSER_BRIDGE: BrowserBridge = {
  navigate: async () => ({ ok: false, error: "browser bridge not available" }),
  getText: async () => ({ ok: false, error: "browser bridge not available" }),
  getHtml: async () => ({ ok: false, error: "browser bridge not available" }),
  getUrl: async () => ({ ok: false, error: "browser bridge not available" }),
};

type CaptureScreenshot = (url: string) => Promise<ScreenshotResult>;

export function ipcSocketPath(): string {
  return join(appSupportDir(), "niwaterm.sock");
}

/**
 * WSL(NixOS等)からniwatermアプリ本体へ接続するためのTCPブリッジのポート。
 * WSLディストロ内からはWindows側のUnix domain socketへ接続できない
 * （9p/drvfs越しにソケットファイルとして扱えず、Linux側から見るとただの空の
 * regular fileになるため。実機検証済み）ため、Windows限定でこのポートも追加でlistenする。
 * packages/cli/src/ipc-client.tsに同じ値を意図的に重複させている（変更時は両方揃えること）。
 */
export const WSL_BRIDGE_PORT = 47831;

/**
 * WSL用のHyper-V仮想アダプタ（"vEthernet (WSL)"等、名前に"wsl"を含むもの）のIPv4アドレスを返す。
 * このアダプタはWindowsホスト⇔WSL VM間の内部NATに閉じており、LAN上の他端末からは到達できない。
 * 0.0.0.0にbindするとLAN全体に露出してしまうため、必ずこのアダプタのIPだけにbindする。
 */
function findWslAdapterAddresses(): string[] {
  const addresses: string[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (!/wsl/i.test(name) || !entries) continue;
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
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

interface TileIdRequestBody {
  tileId: string;
}

function parseTileIdBody(body: unknown): TileIdRequestBody | null {
  const b = body as { tileId?: unknown };
  if (typeof b.tileId !== "string" || b.tileId.length === 0) return null;
  return { tileId: b.tileId };
}

interface WorkspaceIdRequestBody {
  workspaceId: string;
}

function parseWorkspaceIdBody(body: unknown): WorkspaceIdRequestBody | null {
  const b = body as { workspaceId?: unknown };
  if (typeof b.workspaceId !== "string" || b.workspaceId.length === 0) return null;
  return { workspaceId: b.workspaceId };
}

interface TabIdRequestBody {
  tabId: string;
}

function parseTabIdBody(body: unknown): TabIdRequestBody | null {
  const b = body as { tabId?: unknown };
  if (typeof b.tabId !== "string" || b.tabId.length === 0) return null;
  return { tabId: b.tabId };
}

interface BrowserNavigateRequestBody extends TabIdRequestBody {
  url: string;
}

function parseBrowserNavigateBody(body: unknown): BrowserNavigateRequestBody | null {
  const tabIdBody = parseTabIdBody(body);
  if (!tabIdBody) return null;
  const b = body as { url?: unknown };
  if (typeof b.url !== "string" || b.url.length === 0) return null;
  return { ...tabIdBody, url: b.url };
}

interface NewTabRequestBody extends TileIdRequestBody {
  url?: string;
  customView?: boolean;
  shellProfileId?: string;
  cwd?: string;
}

/**
 * url・customView・shellProfileIdいずれも省略されていればデフォルトシェルのターミナルタブ、
 * urlが指定されていればブラウザタブ（空文字列は不可）、customView:trueが指定されていれば
 * 設定済みのユーザー定義HTML UIを開く、shellProfileIdが指定されていればそのプロファイルの
 * シェルでターミナルタブを開く。3つは互いに排他とする。
 * cwdはターミナルタブ（url・customView未指定）専用のオプションで、url・customViewとは同時指定不可
 */
function parseNewTabBody(body: unknown): NewTabRequestBody | null {
  const tileIdBody = parseTileIdBody(body);
  if (!tileIdBody) return null;
  const b = body as {
    url?: unknown;
    customView?: unknown;
    shellProfileId?: unknown;
    cwd?: unknown;
  };
  const hasUrl = b.url !== undefined;
  const hasCustomView = b.customView !== undefined;
  const hasShellProfileId = b.shellProfileId !== undefined;
  const hasCwd = b.cwd !== undefined;
  if ([hasUrl, hasCustomView, hasShellProfileId].filter(Boolean).length > 1) return null;
  if (hasCwd && (hasUrl || hasCustomView)) return null;

  const result: NewTabRequestBody = { ...tileIdBody };
  if (hasCwd) {
    if (typeof b.cwd !== "string" || b.cwd.length === 0) return null;
    result.cwd = b.cwd;
  }
  if (hasShellProfileId) {
    if (typeof b.shellProfileId !== "string" || b.shellProfileId.length === 0) return null;
    result.shellProfileId = b.shellProfileId;
    return result;
  }
  if (hasCustomView) {
    if (b.customView !== true) return null;
    result.customView = true;
    return result;
  }
  if (!hasUrl) return result;
  if (typeof b.url !== "string" || b.url.length === 0) return null;
  result.url = b.url;
  return result;
}

interface SplitTileRequestBody extends TileIdRequestBody {
  orientation: SplitOrientation;
}

function parseSplitTileBody(body: unknown): SplitTileRequestBody | null {
  const tileIdBody = parseTileIdBody(body);
  if (!tileIdBody) return null;
  const b = body as { orientation?: unknown };
  if (b.orientation !== "horizontal" && b.orientation !== "vertical") return null;
  return { ...tileIdBody, orientation: b.orientation };
}

interface TileTabRequestBody extends TileIdRequestBody {
  tabId: string;
}

function parseTileTabBody(body: unknown): TileTabRequestBody | null {
  const tileIdBody = parseTileIdBody(body);
  if (!tileIdBody) return null;
  const b = body as { tabId?: unknown };
  if (typeof b.tabId !== "string" || b.tabId.length === 0) return null;
  return { ...tileIdBody, tabId: b.tabId };
}

/** 英数字・_・-・. のみ、1〜128文字。CLI出力（list-varsのkey=value整形）を壊す空白・改行等を排除する */
const TAB_VAR_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

interface SetVarRequestBody extends TabIdRequestBody {
  key: string;
  value: string;
}

function parseSetVarBody(body: unknown): SetVarRequestBody | null {
  const tabIdBody = parseTabIdBody(body);
  if (!tabIdBody) return null;
  const b = body as { key?: unknown; value?: unknown };
  if (typeof b.key !== "string" || !TAB_VAR_KEY_PATTERN.test(b.key)) return null;
  if (typeof b.value !== "string") return null;
  return { ...tabIdBody, key: b.key, value: b.value };
}

interface ApplyLayoutRequestBody {
  name: string;
  target?: ApplyLayoutTarget;
  cwd?: string;
}

function parseApplyLayoutBody(body: unknown): ApplyLayoutRequestBody | null {
  const b = body as { name?: unknown; target?: unknown; cwd?: unknown };
  if (typeof b.name !== "string" || b.name.length === 0) return null;
  if (b.target !== undefined && b.target !== "new-workspace" && b.target !== "replace") {
    return null;
  }
  const result: ApplyLayoutRequestBody = { name: b.name, target: b.target };
  if (b.cwd !== undefined) {
    if (typeof b.cwd !== "string" || b.cwd.length === 0) return null;
    result.cwd = b.cwd;
  }
  return result;
}

/** JSONボディをパースする。不正なJSONの場合はundefinedを返す */
async function readJsonBody(c: Context): Promise<unknown | undefined> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function buildApp(
  workspaceManager: WorkspaceManager,
  getCustomView: () => ResolvedCustomViewConfig | null,
  activateWindow: () => void,
  browserBridge: BrowserBridge,
  captureScreenshot: CaptureScreenshot,
  getShellProfiles: () => ShellProfile[],
  getLayouts: () => LayoutsConfig,
) {
  const app = new Hono();

  app.get("/ping", (c) => c.json({ ok: true, pid: process.pid }));

  app.get("/list", (c) => c.json({ workspaces: workspaceManager.listWorkspaces() }));

  app.post("/new-workspace", (c) => {
    const workspaceId = workspaceManager.newWorkspace();
    return c.json({ ok: true, workspaceId });
  });

  app.post("/switch-workspace", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseWorkspaceIdBody(body);
    if (!parsed) return c.json({ ok: false, error: "expected { workspaceId: string }" }, 400);
    const ok = workspaceManager.switchWorkspace(parsed.workspaceId);
    if (!ok) return c.json({ ok: false, error: `workspace not found: ${parsed.workspaceId}` }, 404);
    return c.json({ ok: true });
  });

  app.post("/close-workspace", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseWorkspaceIdBody(body);
    if (!parsed) return c.json({ ok: false, error: "expected { workspaceId: string }" }, 400);
    const result = workspaceManager.closeWorkspace(parsed.workspaceId);
    if (!result.ok) {
      if (result.reason === "not-found") {
        return c.json({ ok: false, error: `workspace not found: ${parsed.workspaceId}` }, 404);
      }
      return c.json({ ok: false, error: "cannot close the last workspace" }, 409);
    }
    return c.json({ ok: true });
  });

  app.get("/shell-profiles", (c) => c.json({ ok: true, profiles: getShellProfiles() }));

  app.get("/layouts", (c) => {
    const layouts = Object.entries(getLayouts()).map(([name, preset]) => ({
      name,
      description: preset.description,
    }));
    return c.json({ ok: true, layouts });
  });

  app.post("/apply-layout", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseApplyLayoutBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error: 'expected { name: string, target?: "new-workspace"|"replace", cwd?: string }',
        },
        400,
      );
    }
    const preset = getLayouts()[parsed.name];
    if (!preset) return c.json({ ok: false, error: `layout not found: ${parsed.name}` }, 404);
    const result = applyLayoutPreset(
      workspaceManager,
      getShellProfiles(),
      preset,
      parsed.target ?? "new-workspace",
      parsed.cwd,
    );
    if (!result.ok) return c.json({ ok: false, error: result.error }, 400);
    return c.json({ ok: true, workspaceId: result.workspaceId });
  });

  app.get("/capture-tab", (c) => {
    const tabId = c.req.query("tabId");
    if (!tabId) return c.json({ ok: false, error: "expected ?tabId=<tabId>" }, 400);
    const text = workspaceManager.getTabText(tabId);
    if (text === null) return c.json({ ok: false, error: `tab not found: ${tabId}` }, 404);
    return c.json({ ok: true, text });
  });

  app.post("/send-keys", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
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

  app.post("/split-tile", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseSplitTileBody(body);
    if (!parsed) {
      return c.json(
        { ok: false, error: 'expected { tileId: string, orientation: "horizontal"|"vertical" }' },
        400,
      );
    }
    const result = workspaceManager.splitTile(parsed.tileId, parsed.orientation);
    if (!result) return c.json({ ok: false, error: `tile not found: ${parsed.tileId}` }, 404);
    return c.json({ ok: true, tileId: result.tileId, tabId: result.tabId });
  });

  app.post("/new-tab", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseNewTabBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error:
            "expected { tileId: string, url?: string, customView?: boolean, shellProfileId?: string, cwd?: string } (url, customView, shellProfileId are mutually exclusive; cwd is only valid for terminal tabs)",
        },
        400,
      );
    }
    if (parsed.customView) {
      const customView = getCustomView();
      if (!customView) {
        return c.json({ ok: false, error: "customView is not configured" }, 400);
      }
      const tabId = workspaceManager.newBrowserTab(parsed.tileId, customView.url);
      if (!tabId) return c.json({ ok: false, error: `tile not found: ${parsed.tileId}` }, 404);
      return c.json({ ok: true, tabId });
    }
    if (parsed.url) {
      const tabId = workspaceManager.newBrowserTab(parsed.tileId, parsed.url);
      if (!tabId) return c.json({ ok: false, error: `tile not found: ${parsed.tileId}` }, 404);
      return c.json({ ok: true, tabId });
    }
    const resolved = resolveShellProfileCommand(getShellProfiles(), parsed.shellProfileId);
    if (!resolved.ok) return c.json({ ok: false, error: resolved.error }, 400);
    const tabId = workspaceManager.newTab(parsed.tileId, resolved.command, parsed.cwd);
    if (!tabId) return c.json({ ok: false, error: `tile not found: ${parsed.tileId}` }, 404);
    return c.json({ ok: true, tabId });
  });

  app.post("/switch-tab", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseTileTabBody(body);
    if (!parsed) {
      return c.json({ ok: false, error: "expected { tileId: string, tabId: string }" }, 400);
    }
    const ok = workspaceManager.switchTab(parsed.tileId, parsed.tabId);
    if (!ok) {
      return c.json(
        { ok: false, error: `tile/tab not found: ${parsed.tileId}/${parsed.tabId}` },
        404,
      );
    }
    return c.json({ ok: true });
  });

  app.post("/close-tab", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseTileTabBody(body);
    if (!parsed) {
      return c.json({ ok: false, error: "expected { tileId: string, tabId: string }" }, 400);
    }
    const ok = workspaceManager.closeTab(parsed.tileId, parsed.tabId);
    if (!ok) {
      return c.json(
        { ok: false, error: `tile/tab not found (or last tab): ${parsed.tileId}/${parsed.tabId}` },
        404,
      );
    }
    return c.json({ ok: true });
  });

  app.post("/focus-tile", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseTileIdBody(body);
    if (!parsed) return c.json({ ok: false, error: "expected { tileId: string }" }, 400);
    const ok = workspaceManager.focusTile(parsed.tileId);
    if (!ok) return c.json({ ok: false, error: `tile not found: ${parsed.tileId}` }, 404);
    return c.json({ ok: true });
  });

  app.post("/set-var", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseSetVarBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error:
            "expected { tabId: string, key: string (英数字・_・-・.のみ、1〜128文字), value: string }",
        },
        400,
      );
    }
    const ok = workspaceManager.setTabVar(parsed.tabId, parsed.key, parsed.value);
    if (!ok) return c.json({ ok: false, error: `tab not found: ${parsed.tabId}` }, 404);
    return c.json({ ok: true });
  });

  app.get("/get-var", (c) => {
    const tabId = c.req.query("tabId");
    const key = c.req.query("key");
    if (!tabId || !key) {
      return c.json({ ok: false, error: "expected ?tabId=<tabId>&key=<key>" }, 400);
    }
    const result = workspaceManager.getTabVar(tabId, key);
    if (!result.found) {
      const error =
        result.reason === "tab-not-found"
          ? `tab not found: ${tabId}`
          : `variable not set: ${key} (tab: ${tabId})`;
      return c.json({ ok: false, error }, 404);
    }
    return c.json({ ok: true, value: result.value });
  });

  app.get("/list-vars", (c) => {
    const tabId = c.req.query("tabId");
    if (!tabId) return c.json({ ok: false, error: "expected ?tabId=<tabId>" }, 400);
    const vars = workspaceManager.listTabVars(tabId);
    if (vars === null) return c.json({ ok: false, error: `tab not found: ${tabId}` }, 404);
    return c.json({ ok: true, vars });
  });

  // ブラウザタブのURLを遷移する（Playwrightのpage.goto()相当）。対象タブの所属ワークスペースが
  // 非アクティブ（gcStaleでDOM破棄済みの可能性）な場合は409を返す。人間が確認したい場合は
  // show-tabで先に対象ワークスペースをアクティブ化してから呼び直す
  app.post("/browser-navigate", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseBrowserNavigateBody(body);
    if (!parsed) {
      return c.json({ ok: false, error: "expected { tabId: string, url: string }" }, 400);
    }
    const location = workspaceManager.locateBrowserTab(parsed.tabId);
    if (!location)
      return c.json({ ok: false, error: `browser tab not found: ${parsed.tabId}` }, 404);
    if (!workspaceManager.isWorkspaceActive(location.workspaceId)) {
      return c.json(
        { ok: false, error: `tab's workspace is not active; call show-tab first: ${parsed.tabId}` },
        409,
      );
    }
    const result = await browserBridge.navigate(parsed.tabId, parsed.url);
    if (!result.ok) return c.json({ ok: false, error: result.error }, 409);
    return c.json({ ok: true });
  });

  // ブラウザタブの表示内容をプレーンテキストで取得する（document.body.innerText相当）
  app.get("/browser-get-text", async (c) => {
    const tabId = c.req.query("tabId");
    if (!tabId) return c.json({ ok: false, error: "expected ?tabId=<tabId>" }, 400);
    const location = workspaceManager.locateBrowserTab(tabId);
    if (!location) return c.json({ ok: false, error: `browser tab not found: ${tabId}` }, 404);
    if (!workspaceManager.isWorkspaceActive(location.workspaceId)) {
      return c.json(
        { ok: false, error: `tab's workspace is not active; call show-tab first: ${tabId}` },
        409,
      );
    }
    const result = await browserBridge.getText(tabId);
    if (!result.ok) return c.json({ ok: false, error: result.error }, 409);
    return c.json({ ok: true, text: result.text });
  });

  // ブラウザタブのHTMLを取得する（document.documentElement.outerHTML相当）
  app.get("/browser-get-html", async (c) => {
    const tabId = c.req.query("tabId");
    if (!tabId) return c.json({ ok: false, error: "expected ?tabId=<tabId>" }, 400);
    const location = workspaceManager.locateBrowserTab(tabId);
    if (!location) return c.json({ ok: false, error: `browser tab not found: ${tabId}` }, 404);
    if (!workspaceManager.isWorkspaceActive(location.workspaceId)) {
      return c.json(
        { ok: false, error: `tab's workspace is not active; call show-tab first: ${tabId}` },
        409,
      );
    }
    const result = await browserBridge.getHtml(tabId);
    if (!result.ok) return c.json({ ok: false, error: result.error }, 409);
    return c.json({ ok: true, html: result.html });
  });

  // ブラウザタブの現在URLをheadless WebView（Bun.WebView）で別途開き直してスクリーンショットを取得する。
  // 表示中タブとは別インスタンスのため「今見えている状態そのもの」ではなく
  // 「同じURLを新規に開いた場合の見た目」になる点に注意（詳細: src/bun/browser-screenshot.ts）
  app.get("/browser-screenshot", async (c) => {
    const tabId = c.req.query("tabId");
    if (!tabId) return c.json({ ok: false, error: "expected ?tabId=<tabId>" }, 400);
    const location = workspaceManager.locateBrowserTab(tabId);
    if (!location) return c.json({ ok: false, error: `browser tab not found: ${tabId}` }, 404);
    if (!workspaceManager.isWorkspaceActive(location.workspaceId)) {
      return c.json(
        { ok: false, error: `tab's workspace is not active; call show-tab first: ${tabId}` },
        409,
      );
    }
    const urlResult = await browserBridge.getUrl(tabId);
    if (!urlResult.ok) return c.json({ ok: false, error: urlResult.error }, 409);
    const shotResult = await captureScreenshot(urlResult.url);
    if (!shotResult.ok) return c.json({ ok: false, error: shotResult.error }, 409);
    return new Response(shotResult.data, { status: 200, headers: { "Content-Type": "image/png" } });
  });

  // tabIdだけを受け取り、所属ワークスペースへの切替・タイルフォーカス・タブアクティブ化・ウィンドウ前面化を
  // まとめて行う。人間がAIの操作結果を任意に目視確認するための高レベルコマンド
  // （switch-tab/focus-tileと違いワークスペース跨ぎ・ウィンドウ前面化まで面倒を見る）。
  // 対象ワークスペースが非アクティブであること自体はこのコマンドの通常の対象ケースなので409にはしない
  app.post("/show-tab", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseTabIdBody(body);
    if (!parsed) return c.json({ ok: false, error: "expected { tabId: string }" }, 400);
    const location = workspaceManager.locateTab(parsed.tabId);
    if (!location) return c.json({ ok: false, error: `tab not found: ${parsed.tabId}` }, 404);
    workspaceManager.switchWorkspace(location.workspaceId);
    workspaceManager.focusTile(location.tileId);
    workspaceManager.switchTab(location.tileId, parsed.tabId);
    activateWindow();
    return c.json({ ok: true, workspaceId: location.workspaceId, tileId: location.tileId });
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
  getCustomView: () => ResolvedCustomViewConfig | null = () => null,
  activateWindow: () => void = () => {},
  browserBridge: BrowserBridge = UNAVAILABLE_BROWSER_BRIDGE,
  captureScreenshot: CaptureScreenshot = captureUrlScreenshot,
  getShellProfiles: () => ShellProfile[] = () => [],
  getLayouts: () => LayoutsConfig = () => ({}),
): Promise<IpcServer> {
  // 置き場所（アプリケーションサポートディレクトリ）は初回起動時には存在しない。
  // 無いままlistenするとENOENTでIPCサーバーだけ起動に失敗する
  await mkdir(dirname(path), { recursive: true });
  await removeStaleSocket(path);
  const app = buildApp(
    workspaceManager,
    getCustomView,
    activateWindow,
    browserBridge,
    captureScreenshot,
    getShellProfiles,
    getLayouts,
  );
  const server = Bun.serve({ unix: path, fetch: app.fetch });
  // WSLディストロからは path のUnix domain socketへ接続できないため、Windows限定で
  // WSL用仮想アダプタのIPにだけ追加でTCP listenする。bind失敗はbest effortで無視する
  // （WSLが無効/未使用の環境や、まれなポート競合でIPCサーバー自体を落とさないため）
  const tcpServers =
    process.platform === "win32"
      ? findWslAdapterAddresses().flatMap((hostname) => {
          try {
            return [Bun.serve({ hostname, port: WSL_BRIDGE_PORT, fetch: app.fetch })];
          } catch {
            return [];
          }
        })
      : [];
  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      server.stop();
      for (const tcpServer of tcpServers) tcpServer.stop();
      try {
        unlinkSync(path);
      } catch {
        // すでに消えている等は無視
      }
    },
  };
}
