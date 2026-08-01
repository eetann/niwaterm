// CLI(niwaterm ping等)からの接続を受け付けるunix socket IPCサーバー。
// Electrobunのアプリコードは他のネイティブモジュール同様Bun Worker内で動くため、
// Bun.serveのunixオプションがWorker内でも動作することはsmoke testで実機確認済み。

import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import type { ResolvedCustomViewConfig } from "@niwaterm/config";
import { appSupportDir } from "./app-paths";
import type { SplitOrientation } from "./tile-layout";
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

interface TileIdRequestBody {
  tileId: string;
}

function parseTileIdBody(body: unknown): TileIdRequestBody | null {
  const b = body as { tileId?: unknown };
  if (typeof b.tileId !== "string" || b.tileId.length === 0) return null;
  return { tileId: b.tileId };
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
): Promise<IpcServer> {
  await removeStaleSocket(path);
  const app = buildApp(workspaceManager, getCustomView);
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
