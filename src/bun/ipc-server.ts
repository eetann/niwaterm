// CLI(niwaterm ping等)からの接続を受け付けるunix socket IPCサーバー。
// Electrobunのアプリコードは他のネイティブモジュール同様Bun Worker内で動くため、
// Bun.serveのunixオプションがWorker内でも動作することはsmoke testで実機確認済み。

import { unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Hono, type Context } from "hono";
import type { ResolvedCustomViewConfig } from "@niwaterm/config";
import { appSupportDir } from "./app-paths";
import type { BrowserBridge } from "./browser-bridge";
import { captureUrlScreenshot, type ScreenshotResult } from "./browser-screenshot";
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
}

/**
 * url・customViewいずれも省略されていればターミナルタブ、urlが指定されていればブラウザタブ
 * （空文字列は不可）、customView:trueが指定されていれば設定済みのユーザー定義HTML UIを開く。
 * urlとcustomViewの同時指定は不正とする。
 */
function parseNewTabBody(body: unknown): NewTabRequestBody | null {
  const tileIdBody = parseTileIdBody(body);
  if (!tileIdBody) return null;
  const b = body as { url?: unknown; customView?: unknown };
  const hasUrl = b.url !== undefined;
  const hasCustomView = b.customView !== undefined;
  if (hasUrl && hasCustomView) return null;
  if (hasCustomView) {
    if (b.customView !== true) return null;
    return { ...tileIdBody, customView: true };
  }
  if (!hasUrl) return tileIdBody;
  if (typeof b.url !== "string" || b.url.length === 0) return null;
  return { ...tileIdBody, url: b.url };
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
const TILE_VAR_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

interface SetVarRequestBody extends TileIdRequestBody {
  key: string;
  value: string;
}

function parseSetVarBody(body: unknown): SetVarRequestBody | null {
  const tileIdBody = parseTileIdBody(body);
  if (!tileIdBody) return null;
  const b = body as { key?: unknown; value?: unknown };
  if (typeof b.key !== "string" || !TILE_VAR_KEY_PATTERN.test(b.key)) return null;
  if (typeof b.value !== "string") return null;
  return { ...tileIdBody, key: b.key, value: b.value };
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
) {
  const app = new Hono();

  app.get("/ping", (c) => c.json({ ok: true, pid: process.pid }));

  app.get("/list", (c) => c.json({ workspaces: workspaceManager.listWorkspaces() }));

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
            "expected { tileId: string, url?: string, customView?: boolean } (url and customView are mutually exclusive)",
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
    const tabId = parsed.url
      ? workspaceManager.newBrowserTab(parsed.tileId, parsed.url)
      : workspaceManager.newTab(parsed.tileId);
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
            "expected { tileId: string, key: string (英数字・_・-・.のみ、1〜128文字), value: string }",
        },
        400,
      );
    }
    const ok = workspaceManager.setTileVar(parsed.tileId, parsed.key, parsed.value);
    if (!ok) return c.json({ ok: false, error: `tile not found: ${parsed.tileId}` }, 404);
    return c.json({ ok: true });
  });

  app.get("/get-var", (c) => {
    const tileId = c.req.query("tileId");
    const key = c.req.query("key");
    if (!tileId || !key) {
      return c.json({ ok: false, error: "expected ?tileId=<tileId>&key=<key>" }, 400);
    }
    const result = workspaceManager.getTileVar(tileId, key);
    if (!result.found) {
      const error =
        result.reason === "tile-not-found"
          ? `tile not found: ${tileId}`
          : `variable not set: ${key} (tile: ${tileId})`;
      return c.json({ ok: false, error }, 404);
    }
    return c.json({ ok: true, value: result.value });
  });

  app.get("/list-vars", (c) => {
    const tileId = c.req.query("tileId");
    if (!tileId) return c.json({ ok: false, error: "expected ?tileId=<tileId>" }, 400);
    const vars = workspaceManager.listTileVars(tileId);
    if (vars === null) return c.json({ ok: false, error: `tile not found: ${tileId}` }, 404);
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
  );
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
