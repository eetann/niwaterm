// CLI(niwaterm ping等)からの接続を受け付けるunix socket IPCサーバー。
// Electrobunのアプリコードは他のネイティブモジュール同様Bun Worker内で動くため、
// Bun.serveのunixオプションがWorker内でも動作することはsmoke testで実機確認済み。

import { unlinkSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { Hono, type Context } from "hono";
import type {
  LayoutsConfig,
  NiwaNotifyOptions,
  ResolvedCustomViewConfig,
  ShellProfile,
} from "@niwaterm/config";
import { appSupportDir } from "./app-paths";
import type { BrowserBridge } from "./browser-bridge";
import { captureUrlScreenshot, type ScreenshotResult } from "./browser-screenshot";
import { applyLayoutPreset, type ApplyLayoutTarget } from "./layout-apply";
import {
  loadProjectPreset,
  listResolvedLayouts,
  resolveLayoutPresetByName,
} from "./project-config";
import { DEFAULT_RESIZE_AMOUNT } from "./niwa-api";
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
 * WSL(NixOS等)からniwatermアプリ本体へ接続するためのTCPブリッジ。
 * WSLディストロ内からはWindows側のUnix domain socketへ接続できない
 * （9p/drvfs越しにソケットファイルとして扱えず、Linux側から見るとただの空の
 * regular fileになるため。実機検証済み）ため、Windows限定でTCPも追加でlistenする。
 *
 * ポート番号は固定せずOSに割り当てさせる。固定ポートは他アプリと衝突しうるうえ、
 * WSL2のミラーモードではWSL側のエフェメラルポート範囲と重なるとbindすらできず、
 * しかもその予約はnetstatにもnetshにも現れない
 * （docs/known-issues/wsl-mirrored-mode-breaks-tcp-bridge.md参照）。
 * 割り当てられた実ポートはbridgePortFilePath()のファイルへ書き出し、CLIはそれを読む。
 */
let wslBridgePort: number | null = null;

/**
 * 実際にlistenしているWSLブリッジのポート。listenするまで、およびブリッジを立てない
 * プラットフォーム（macOS等）ではnull。
 * PTY起動時のNIWATERM_BRIDGE_PORT注入（board.ts・config.ts・popup.ts）で使う
 */
export function getWslBridgePort(): number | null {
  return wslBridgePort;
}

/**
 * ブリッジの実ポートを書き出すファイル。Unix domain socketと同じディレクトリに置く。
 * WSLからはソケットそのものは使えない（DrvFsがソケットを表現できない）が、
 * ただのregular fileなら/mnt/c越しに読めるため、CLIはこれで接続先ポートを知る
 * （packages/cli/src/ipc-client.tsのreadBridgePortFile参照）
 */
function bridgePortFilePath(socketPath: string): string {
  return join(dirname(socketPath), "bridge-port");
}

/**
 * TCPブリッジをlistenするアドレスを返す。WSL2のネットワークモードによってWSL側から
 * Windowsホストへ届く経路が変わるため、両モード分をまとめてlistenする。
 *
 * - `127.0.0.1`: ミラーモード（`.wslconfig`の`networkingMode=mirrored`）用。
 *   このモードではWSL用仮想アダプタのIPへは到達できず（アダプタ自体はWindows側に
 *   残るがWSL VMとの通信には使われない）、WSLからの接続はWindowsホストの
 *   ループバックに届く（実機確認済み）
 * - WSL用のHyper-V仮想アダプタ（"vEthernet (WSL)"等、名前に"wsl"を含むもの）のIPv4:
 *   NATモード（WSL2の既定）用。Windowsホスト⇔WSL VM間の内部NATに閉じている
 *
 * どちらもLAN上の他端末からは到達できない。0.0.0.0にbindするとLAN全体へ露出するため使わない。
 */
function bridgeBindAddresses(): string[] {
  const addresses: string[] = ["127.0.0.1"];
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

interface RespawnTabRequestBody extends TabIdRequestBody {
  shellProfileId?: string;
  cwd?: string;
  command?: string;
}

function parseRespawnTabBody(body: unknown): RespawnTabRequestBody | null {
  const tabIdBody = parseTabIdBody(body);
  if (!tabIdBody) return null;
  const b = body as { shellProfileId?: unknown; cwd?: unknown; command?: unknown };
  const result: RespawnTabRequestBody = { ...tabIdBody };
  if (b.shellProfileId !== undefined) {
    if (typeof b.shellProfileId !== "string" || b.shellProfileId.length === 0) return null;
    result.shellProfileId = b.shellProfileId;
  }
  if (b.cwd !== undefined) {
    if (typeof b.cwd !== "string" || b.cwd.length === 0) return null;
    result.cwd = b.cwd;
  }
  if (b.command !== undefined) {
    if (typeof b.command !== "string" || b.command.length === 0) return null;
    result.command = b.command;
  }
  return result;
}

interface SplitTileRequestBody extends TileIdRequestBody {
  orientation: SplitOrientation;
  cwd?: string;
}

function parseSplitTileBody(body: unknown): SplitTileRequestBody | null {
  const tileIdBody = parseTileIdBody(body);
  if (!tileIdBody) return null;
  const b = body as { orientation?: unknown; cwd?: unknown };
  if (b.orientation !== "horizontal" && b.orientation !== "vertical") return null;
  const result: SplitTileRequestBody = { ...tileIdBody, orientation: b.orientation };
  if (b.cwd !== undefined) {
    if (typeof b.cwd !== "string" || b.cwd.length === 0) return null;
    result.cwd = b.cwd;
  }
  return result;
}

interface DirectionRequestBody {
  direction: "up" | "down" | "left" | "right";
}

function parseDirectionBody(body: unknown): DirectionRequestBody | null {
  const b = body as { direction?: unknown };
  if (
    b.direction !== "up" &&
    b.direction !== "down" &&
    b.direction !== "left" &&
    b.direction !== "right"
  ) {
    return null;
  }
  return { direction: b.direction };
}

interface ResizeTileRequestBody extends TileIdRequestBody {
  direction: "up" | "down" | "left" | "right";
  amount?: number;
}

function parseResizeTileBody(body: unknown): ResizeTileRequestBody | null {
  const tileIdBody = parseTileIdBody(body);
  if (!tileIdBody) return null;
  const b = body as { direction?: unknown; amount?: unknown };
  if (
    b.direction !== "up" &&
    b.direction !== "down" &&
    b.direction !== "left" &&
    b.direction !== "right"
  ) {
    return null;
  }
  const result: ResizeTileRequestBody = { ...tileIdBody, direction: b.direction };
  if (b.amount !== undefined) {
    if (typeof b.amount !== "number" || !(b.amount > 0 && b.amount <= 1)) return null;
    result.amount = b.amount;
  }
  return result;
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

/** 英数字・_・-・. のみ、1〜128文字。CLI出力（tab var listのkey=value整形）を壊す空白・改行等を排除する */
const TAB_VAR_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

interface SetVarRequestBody extends TabIdRequestBody {
  key: string;
  value: string;
}

interface RenameWorkspaceRequestBody extends WorkspaceIdRequestBody {
  name: string;
}

function parseRenameWorkspaceBody(body: unknown): RenameWorkspaceRequestBody | null {
  const workspaceIdBody = parseWorkspaceIdBody(body);
  if (!workspaceIdBody) return null;
  const b = body as { name?: unknown };
  if (typeof b.name !== "string") return null;
  return { ...workspaceIdBody, name: b.name };
}

interface BoardIdRequestBody {
  boardId: string;
}

function parseBoardIdBody(body: unknown): BoardIdRequestBody | null {
  const b = body as { boardId?: unknown };
  if (typeof b.boardId !== "string" || b.boardId.length === 0) return null;
  return { boardId: b.boardId };
}

interface NewBoardRequestBody {
  workspaceId?: string;
  cwd?: string;
}

/** workspaceId省略時はgetActiveWorkspaceId()で解決する（エンドポイント側の責務） */
function parseNewBoardBody(body: unknown): NewBoardRequestBody | null {
  const b = body as { workspaceId?: unknown; cwd?: unknown };
  const result: NewBoardRequestBody = {};
  if (b.workspaceId !== undefined) {
    if (typeof b.workspaceId !== "string" || b.workspaceId.length === 0) return null;
    result.workspaceId = b.workspaceId;
  }
  if (b.cwd !== undefined) {
    if (typeof b.cwd !== "string" || b.cwd.length === 0) return null;
    result.cwd = b.cwd;
  }
  return result;
}

interface RenameBoardRequestBody extends BoardIdRequestBody {
  name: string;
}

function parseRenameBoardBody(body: unknown): RenameBoardRequestBody | null {
  const boardIdBody = parseBoardIdBody(body);
  if (!boardIdBody) return null;
  const b = body as { name?: unknown };
  if (typeof b.name !== "string") return null;
  return { ...boardIdBody, name: b.name };
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
  /** target: "new-board"時、Boardの作成先workspaceId（省略時はアクティブworkspace） */
  workspaceId?: string;
  /** target: "replace"時、対象boardId（省略時はアクティブworkspaceのアクティブboard） */
  boardId?: string;
  /** trueなら次回起動時もこのプリセットで組み直す。省略時はrestoreMode: "restore" */
  startup?: boolean;
  /** プロジェクトローカル由来プリセットのtrust promptに同意済みか */
  trust?: boolean;
}

function parseApplyLayoutBody(body: unknown): ApplyLayoutRequestBody | null {
  const b = body as {
    name?: unknown;
    target?: unknown;
    cwd?: unknown;
    workspaceId?: unknown;
    boardId?: unknown;
    startup?: unknown;
    trust?: unknown;
  };
  if (typeof b.name !== "string" || b.name.length === 0) return null;
  if (b.target !== undefined && b.target !== "new-board" && b.target !== "replace") {
    return null;
  }
  const result: ApplyLayoutRequestBody = { name: b.name, target: b.target };
  if (b.cwd !== undefined) {
    if (typeof b.cwd !== "string" || b.cwd.length === 0) return null;
    result.cwd = b.cwd;
  }
  if (b.workspaceId !== undefined) {
    if (typeof b.workspaceId !== "string" || b.workspaceId.length === 0) return null;
    result.workspaceId = b.workspaceId;
  }
  if (b.boardId !== undefined) {
    if (typeof b.boardId !== "string" || b.boardId.length === 0) return null;
    result.boardId = b.boardId;
  }
  if (b.startup !== undefined) {
    if (typeof b.startup !== "boolean") return null;
    result.startup = b.startup;
  }
  if (b.trust !== undefined) {
    if (typeof b.trust !== "boolean") return null;
    result.trust = b.trust;
  }
  return result;
}

interface BoardStartupRequestBody {
  /** 省略時はアクティブworkspaceのアクティブBoard */
  boardId?: string;
  /**
   * "layout": 起動時にpresetのレイアウトで組み直す。"restore": 保存した骨格を復元する（既定の挙動）。
   * "clear": プリセットの紐づけ自体を解除する
   */
  mode: "layout" | "restore" | "clear";
  /** modeが"clear"以外のときのプリセット名。省略時は現在紐づいているプリセットを引き継ぐ */
  preset?: string;
  /** プリセットの解決元を決めるCLIのcwd。presetを明示指定したときのみ使う */
  cwd?: string;
  /** プロジェクトローカル由来プリセットのtrust promptに同意済みか */
  trust?: boolean;
}

function parseBoardStartupBody(body: unknown): BoardStartupRequestBody | null {
  const b = body as {
    boardId?: unknown;
    mode?: unknown;
    preset?: unknown;
    cwd?: unknown;
    trust?: unknown;
  };
  if (b.mode !== "layout" && b.mode !== "restore" && b.mode !== "clear") return null;
  const result: BoardStartupRequestBody = { mode: b.mode };
  if (b.boardId !== undefined) {
    if (typeof b.boardId !== "string" || b.boardId.length === 0) return null;
    result.boardId = b.boardId;
  }
  if (b.preset !== undefined) {
    if (typeof b.preset !== "string" || b.preset.length === 0) return null;
    result.preset = b.preset;
  }
  if (b.cwd !== undefined) {
    if (typeof b.cwd !== "string" || b.cwd.length === 0) return null;
    result.cwd = b.cwd;
  }
  if (b.trust !== undefined) {
    if (typeof b.trust !== "boolean") return null;
    result.trust = b.trust;
  }
  return result;
}

interface PopupRequestBody {
  cwd?: string;
  command?: string;
  width?: number;
  height?: number;
  wait?: boolean;
  captureStdout?: boolean;
}

/** widthHeightは1〜100の整数パーセントのみ許可する */
function isValidPopupSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100;
}

function parsePopupBody(body: unknown): PopupRequestBody | null {
  const b = body as {
    cwd?: unknown;
    command?: unknown;
    width?: unknown;
    height?: unknown;
    wait?: unknown;
    captureStdout?: unknown;
  };
  const result: PopupRequestBody = {};
  if (b.cwd !== undefined) {
    if (typeof b.cwd !== "string" || b.cwd.length === 0) return null;
    result.cwd = b.cwd;
  }
  if (b.command !== undefined) {
    if (typeof b.command !== "string" || b.command.length === 0) return null;
    result.command = b.command;
  }
  if (b.width !== undefined) {
    if (!isValidPopupSize(b.width)) return null;
    result.width = b.width;
  }
  if (b.height !== undefined) {
    if (!isValidPopupSize(b.height)) return null;
    result.height = b.height;
  }
  if (b.wait !== undefined) {
    if (typeof b.wait !== "boolean") return null;
    result.wait = b.wait;
  }
  if (b.captureStdout !== undefined) {
    if (typeof b.captureStdout !== "boolean") return null;
    result.captureStdout = b.captureStdout;
  }
  // captureStdoutはcommandの標準出力を受け取る機能のため、commandなしでは意味を成さない
  if (result.captureStdout && result.command === undefined) return null;
  return result;
}

interface NotifyRequestBody {
  title: string;
  body?: string;
  subtitle?: string;
  silent?: boolean;
}

function parseNotifyBody(body: unknown): NotifyRequestBody | null {
  const b = body as {
    title?: unknown;
    body?: unknown;
    subtitle?: unknown;
    silent?: unknown;
  };
  if (typeof b.title !== "string" || b.title.length === 0) return null;
  const result: NotifyRequestBody = { title: b.title };
  if (b.body !== undefined) {
    if (typeof b.body !== "string") return null;
    result.body = b.body;
  }
  if (b.subtitle !== undefined) {
    if (typeof b.subtitle !== "string") return null;
    result.subtitle = b.subtitle;
  }
  if (b.silent !== undefined) {
    if (typeof b.silent !== "boolean") return null;
    result.silent = b.silent;
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

type FontSizeAction = "increase" | "decrease" | "reset";

function parseFontSizeAction(body: unknown): FontSizeAction | null {
  const action = (body as { action?: unknown } | undefined)?.action;
  return action === "increase" || action === "decrease" || action === "reset" ? action : null;
}

function buildApp(
  workspaceManager: WorkspaceManager,
  getCustomView: () => ResolvedCustomViewConfig | null,
  activateWindow: () => void,
  browserBridge: BrowserBridge,
  captureScreenshot: CaptureScreenshot,
  getShellProfiles: () => ShellProfile[],
  getLayouts: () => LayoutsConfig,
  increaseFontSize: () => number,
  decreaseFontSize: () => number,
  resetFontSize: () => number,
  sendNotification: (opts: NiwaNotifyOptions) => void,
) {
  const app = new Hono();

  app.get("/ping", (c) => c.json({ ok: true, pid: process.pid }));

  app.get("/list", (c) => c.json({ workspaces: workspaceManager.listWorkspaces() }));

  // CLIが`--tile`等を省略された時の既定の対象を引くための解決口。`tabId`には呼び出し元タブ
  // （PTYへ注入したNIWATERM_TAB_ID）が渡る。タイル階層に居ないタブ（ポップアップ）や、
  // niwatermの外から叩かれてtabIdが無い場合は、アクティブなワークスペース→アクティブBoard→
  // フォーカス中タイル→そのアクティブタブへ落とす。
  // 存在しないtabIdでも404にせずフォールバックするのは、CLIが明示指定された値をここの結果で
  // 上書きしない（省略された項目だけ埋める）ため、誤ったIDは本来の操作側で
  // 「tile/tab not found」として弾かれるから
  app.get("/resolve-target", (c) => {
    const scopeTabId = c.req.query("tabId");
    const location = scopeTabId ? workspaceManager.locateTab(scopeTabId) : null;
    const workspaceId = location?.workspaceId ?? workspaceManager.getActiveWorkspaceId();
    const boardId =
      location?.boardId ?? workspaceManager.listWorkspaces().find((w) => w.active)?.activeBoardId;
    if (!boardId) return c.json({ ok: false, error: "active board not found" }, 404);
    const tileId = location?.tileId ?? workspaceManager.getFocusedTileId();
    // ポップアップのタブはタイル階層に居ないためlocationはnullになるが、tabId自体は
    // 呼び出し元のものが正しい
    const tabId =
      scopeTabId && workspaceManager.hasTab(scopeTabId)
        ? scopeTabId
        : workspaceManager.getActiveTabId(tileId);
    if (!tabId) return c.json({ ok: false, error: `active tab not found in tile: ${tileId}` }, 404);
    return c.json({ ok: true, workspaceId, boardId, tileId, tabId });
  });

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

  app.post("/rename-workspace", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseRenameWorkspaceBody(body);
    if (!parsed) {
      return c.json({ ok: false, error: "expected { workspaceId: string, name: string }" }, 400);
    }
    const ok = workspaceManager.setWorkspaceName(parsed.workspaceId, parsed.name);
    if (!ok) return c.json({ ok: false, error: `workspace not found: ${parsed.workspaceId}` }, 404);
    return c.json({ ok: true });
  });

  app.post("/new-board", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseNewBoardBody(body);
    if (!parsed) {
      return c.json({ ok: false, error: "expected { workspaceId?: string, cwd?: string }" }, 400);
    }
    const workspaceId = parsed.workspaceId ?? workspaceManager.getActiveWorkspaceId();
    const boardId = workspaceManager.newBoard(workspaceId, parsed.cwd);
    if (boardId === null) {
      return c.json({ ok: false, error: `workspace not found: ${workspaceId}` }, 404);
    }
    return c.json({ ok: true, boardId });
  });

  app.post("/switch-board", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseBoardIdBody(body);
    if (!parsed) return c.json({ ok: false, error: "expected { boardId: string }" }, 400);
    const ok = workspaceManager.switchBoard(parsed.boardId);
    if (!ok) return c.json({ ok: false, error: `board not found: ${parsed.boardId}` }, 404);
    return c.json({ ok: true });
  });

  app.post("/close-board", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseBoardIdBody(body);
    if (!parsed) return c.json({ ok: false, error: "expected { boardId: string }" }, 400);
    const result = workspaceManager.closeBoard(parsed.boardId);
    if (!result.ok) {
      if (result.reason === "not-found") {
        return c.json({ ok: false, error: `board not found: ${parsed.boardId}` }, 404);
      }
      return c.json({ ok: false, error: "cannot close the last board in a workspace" }, 409);
    }
    return c.json({ ok: true });
  });

  app.post("/rename-board", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseRenameBoardBody(body);
    if (!parsed) {
      return c.json({ ok: false, error: "expected { boardId: string, name: string }" }, 400);
    }
    const ok = workspaceManager.setBoardName(parsed.boardId, parsed.name);
    if (!ok) return c.json({ ok: false, error: `board not found: ${parsed.boardId}` }, 404);
    return c.json({ ok: true });
  });

  app.get("/shell-profiles", (c) => c.json({ ok: true, profiles: getShellProfiles() }));

  // cwdを渡すと、そこから解決できるプロジェクトローカルのプリセット（<projectRoot>/.niwaterm/config.ts）も
  // 併せて一覧する。同名はプロジェクト側だけを返し、実際にapplyされる方に揃える
  app.get("/layouts", async (c) => {
    const layouts = await listResolvedLayouts(c.req.query("cwd"), getLayouts());
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
          error:
            'expected { name: string, target?: "new-board"|"replace", cwd?: string, workspaceId?: string, boardId?: string }',
        },
        400,
      );
    }
    const resolved = await resolveLayoutPresetByName(parsed.name, parsed.cwd, getLayouts());
    if (!resolved) return c.json({ ok: false, error: `layout not found: ${parsed.name}` }, 404);
    // プロジェクトローカル由来のプリセットを起動時レイアウトに紐づける操作は、以後アプリ起動のたびに
    // そのリポジトリのコードとcommandが自動実行されることを意味する。CLI側でtrust promptを出させ、
    // 同意（trust: true）を得てから再送してもらう
    if (parsed.startup && resolved.projectRoot && !parsed.trust) {
      return c.json({
        ok: false,
        needsTrust: { projectRoot: resolved.projectRoot, preset: parsed.name },
        error: `layout "${parsed.name}" is defined in ${resolved.projectRoot}/.niwaterm/config.ts. Applying it at startup runs that repository's code and commands on every launch. Confirm interactively, or pass --trust if you trust it.`,
      });
    }

    const target = parsed.target ?? "new-board";
    let boardId: string;
    if (target === "new-board") {
      const workspaceId = parsed.workspaceId ?? workspaceManager.getActiveWorkspaceId();
      const newId = workspaceManager.newBoard(workspaceId, parsed.cwd);
      if (newId === null) {
        return c.json({ ok: false, error: `workspace not found: ${workspaceId}` }, 404);
      }
      boardId = newId;
    } else {
      const resolvedBoardId =
        parsed.boardId ?? workspaceManager.listWorkspaces().find((w) => w.active)?.activeBoardId;
      if (!resolvedBoardId || !workspaceManager.hasBoard(resolvedBoardId)) {
        return c.json({ ok: false, error: `board not found: ${resolvedBoardId ?? ""}` }, 404);
      }
      boardId = resolvedBoardId;
    }

    const result = applyLayoutPreset(
      workspaceManager,
      getShellProfiles(),
      resolved.preset,
      target,
      boardId,
      {
        ...(parsed.cwd !== undefined ? { invocationCwd: parsed.cwd } : {}),
        ...(resolved.projectRoot ? { projectRoot: resolved.projectRoot } : {}),
      },
    );
    if (!result.ok) return c.json({ ok: false, error: result.error }, 400);
    // どのプリセットから生えたBoardかを記録しておく。--startup指定時のみ
    // 起動時の組み直し対象になり、それ以外は名前を覚えるだけで従来どおり骨格を復元する。
    // プロジェクトローカル由来なら解決元も一緒に記録する（起動時にはcwdが無いため）
    workspaceManager.setBoardStartup(result.boardId, {
      preset: parsed.name,
      restoreMode: parsed.startup ? "layout" : "restore",
      ...(resolved.projectRoot ? { projectRoot: resolved.projectRoot } : {}),
    });
    return c.json({
      ok: true,
      boardId: result.boardId,
      ...(resolved.projectRoot ? { projectRoot: resolved.projectRoot } : {}),
    });
  });

  app.post("/board-startup", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseBoardStartupBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error: 'expected { mode: "layout"|"restore"|"clear", boardId?: string, preset?: string }',
        },
        400,
      );
    }
    const boardId =
      parsed.boardId ?? workspaceManager.listWorkspaces().find((w) => w.active)?.activeBoardId;
    if (!boardId || !workspaceManager.hasBoard(boardId)) {
      return c.json({ ok: false, error: `board not found: ${parsed.boardId ?? ""}` }, 404);
    }
    if (parsed.mode === "clear") {
      workspaceManager.setBoardStartup(boardId, null);
      return c.json({ ok: true, boardId, startup: null });
    }
    const existing = workspaceManager.getBoardStartup(boardId);
    const preset = parsed.preset ?? existing?.preset;
    if (!preset) {
      return c.json(
        {
          ok: false,
          error: `board ${boardId} has no layout preset; pass preset to associate one`,
        },
        400,
      );
    }
    // presetを明示指定されたときだけ解決し直す。省略時は既存の紐づけ（解決元込み）を引き継ぎ、
    // 別ディレクトリからmodeだけ切り替えても解決元が入れ替わらないようにする
    let projectRoot: string | null;
    if (parsed.preset !== undefined) {
      const resolved = await resolveLayoutPresetByName(parsed.preset, parsed.cwd, getLayouts());
      if (!resolved) return c.json({ ok: false, error: `layout not found: ${preset}` }, 404);
      projectRoot = resolved.projectRoot;
    } else {
      projectRoot = existing?.projectRoot ?? null;
      const stillExists = projectRoot
        ? (await loadProjectPreset(projectRoot, preset)) !== null
        : getLayouts()[preset] !== undefined;
      if (!stillExists) return c.json({ ok: false, error: `layout not found: ${preset}` }, 404);
    }
    if (parsed.mode === "layout" && projectRoot && !parsed.trust) {
      return c.json({
        ok: false,
        needsTrust: { projectRoot, preset },
        error: `layout "${preset}" is defined in ${projectRoot}/.niwaterm/config.ts. Applying it at startup runs that repository's code and commands on every launch. Confirm interactively, or pass --trust if you trust it.`,
      });
    }
    const startup = {
      preset,
      restoreMode: parsed.mode,
      ...(projectRoot ? { projectRoot } : {}),
    };
    workspaceManager.setBoardStartup(boardId, startup);
    return c.json({ ok: true, boardId, startup });
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
        {
          ok: false,
          error: 'expected { tileId: string, orientation: "horizontal"|"vertical", cwd?: string }',
        },
        400,
      );
    }
    const result = workspaceManager.splitTile(
      parsed.tileId,
      parsed.orientation,
      undefined,
      parsed.cwd,
    );
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

  app.post("/respawn-tab", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseRespawnTabBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error:
            "expected { tabId: string, shellProfileId?: string, cwd?: string, command?: string }",
        },
        400,
      );
    }
    const resolved = resolveShellProfileCommand(getShellProfiles(), parsed.shellProfileId);
    if (!resolved.ok) return c.json({ ok: false, error: resolved.error }, 400);
    const ok = workspaceManager.respawnTab(
      parsed.tabId,
      resolved.command,
      parsed.cwd,
      parsed.command,
    );
    if (!ok) {
      return c.json({ ok: false, error: `tab not found (or browser tab): ${parsed.tabId}` }, 404);
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

  app.post("/focus-direction", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseDirectionBody(body);
    if (!parsed) {
      return c.json(
        { ok: false, error: 'expected { direction: "up"|"down"|"left"|"right" }' },
        400,
      );
    }
    workspaceManager.focusDirection(parsed.direction);
    return c.json({ ok: true });
  });

  app.post("/zoom-tile", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseTileIdBody(body);
    if (!parsed) return c.json({ ok: false, error: "expected { tileId: string }" }, 400);
    const zoomed = workspaceManager.toggleZoomTile(parsed.tileId);
    if (zoomed === null)
      return c.json({ ok: false, error: `tile not found: ${parsed.tileId}` }, 404);
    return c.json({ ok: true, zoomed });
  });

  app.post("/resize-tile", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseResizeTileBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error:
            'expected { tileId: string, direction: "up"|"down"|"left"|"right", amount?: number(0<x<=1) }',
        },
        400,
      );
    }
    const ok = workspaceManager.resizeTileInDirection(
      parsed.tileId,
      parsed.direction,
      parsed.amount ?? DEFAULT_RESIZE_AMOUNT,
    );
    if (!ok) {
      return c.json(
        {
          ok: false,
          error: `cannot resize tile "${parsed.tileId}" toward "${parsed.direction}" (tile not found, or no matching split ancestor on that axis)`,
        },
        404,
      );
    }
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

  // 検索スコープはBoard単位（ADR 0006により`layout apply`の適用先がBoard単位なので、
  // 「同じレイアウトプリセット内のタブ」= 同じBoard内のタブ）。boardIdは
  // 明示指定 > scopeTabId（呼び出し元タブ）の所属Board > アクティブBoard の順に解決する。
  // scopeTabIdを挟むのは、プリセットのcommandが実際に走るのはPTY起動・シェル初期化を待った後で
  // （layout-apply.tsのsendInitialInput・delay）、その時点でアクティブBoardが
  // 切り替わっていても呼び出し元自身のBoardを正しく指せるようにするため
  app.get("/find-vars", (c) => {
    const key = c.req.query("key");
    const value = c.req.query("value");
    if (!key || !value) {
      return c.json(
        {
          ok: false,
          error: "expected ?key=<key>&value=<value>[&boardId=<boardId>][&scopeTabId=<tabId>]",
        },
        400,
      );
    }
    let boardId = c.req.query("boardId");
    const scopeTabId = c.req.query("scopeTabId");
    if (!boardId && scopeTabId) {
      const location = workspaceManager.locateTab(scopeTabId);
      if (!location) return c.json({ ok: false, error: `tab not found: ${scopeTabId}` }, 404);
      boardId = location.boardId;
    }
    boardId ??= workspaceManager.listWorkspaces().find((w) => w.active)?.activeBoardId;
    if (!boardId) return c.json({ ok: false, error: "active board not found" }, 404);
    const tabIds = workspaceManager.findTabsByVarInBoard(boardId, key, value);
    if (tabIds === null) return c.json({ ok: false, error: `board not found: ${boardId}` }, 404);
    return c.json({ ok: true, tabIds });
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
    // 永続化対象のURLをここで追従させる（ページ内リンク遷移等の追跡は非対応、既知の制約）
    workspaceManager.setBrowserTabUrl(parsed.tabId, parsed.url);
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

  // アクティブなワークスペースにポップアップを開く（tmuxのpopup/floating相当、ADR 0005）。
  // cwd省略時はフォーカス中タイルのアクティブタブのcwdを引き継ぐ。commandを指定すると
  // デフォルトシェル（WSLプロファイル等も含む）でPTYを起動した上でそのコマンドを流し込み、
  // 終了すると自動的にポップアップも閉じる（ワンショット実行、詳細: workspace.tsのopenPopup）
  app.post("/popup", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parsePopupBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error:
            "expected { cwd?: string, command?: string, width?: number (1-100), height?: number (1-100), wait?: boolean, captureStdout?: boolean (requires command) }",
        },
        400,
      );
    }
    const tabId = workspaceManager.openPopup(parsed);
    if (!tabId) return c.json({ ok: false, error: "a popup is already open" }, 409);
    // activateWindow()は意図的に呼ばない: mainWindow.activate()を呼ぶと、Windows実機で
    // webviewのOSキーボードフォーカスが壊れ、以後JS側からfocus()を何度呼んでも回復せず
    // マウスクリックでしか復帰できなくなる不具合がある（詳細: docs/known-issues/
    // windows-popup-activatewindow-focus-loss.md）。popupは既にniwatermを操作中に開く
    // ケースが主なので、ウィンドウ前面化なしでも実用上の支障は小さいと判断した
    //
    // wait: trueの場合、ポップアップが閉じる（コマンド終了・手動close・昇格いずれも）まで
    // レスポンスを遅らせる。openPopupと同期的に呼ぶことで、待機中にアクティブワークスペースが
    // 切り替わっても開いた時点のポップアップを見続ける（workspace-manager.ts参照）。
    // captureStdout: trueは結果を受け取るのに待機が前提のため、waitが未指定でも待つ
    // （fzf-tmuxの`fzf ... > $fifo; cat $fifo`相当。詳細: docs/guide/cli.md「popup open」節）
    if (parsed.wait || parsed.captureStdout) {
      const output = await workspaceManager.waitForPopupClose();
      if (parsed.captureStdout) return c.json({ ok: true, tabId, stdout: output ?? "" });
    }
    return c.json({ ok: true, tabId });
  });

  app.post("/close-popup", (c) => {
    const ok = workspaceManager.closePopup();
    if (!ok) return c.json({ ok: false, error: "no popup is open" }, 409);
    return c.json({ ok: true });
  });

  app.post("/toggle-popup", (c) => {
    const visible = workspaceManager.togglePopupVisibility();
    if (visible === null) return c.json({ ok: false, error: "no popup is open" }, 409);
    return c.json({ ok: true, visible });
  });

  // ポップアップの中身をフォーカス中タイルへ通常タブとして編入する（タブへ昇格。ADR 0005）。
  // PTYセッションは作り直さないため、workspaceManager.promotePopup()はセッション生成を伴わない
  app.post("/promote-popup", (c) => {
    const result = workspaceManager.promotePopup();
    if (!result) return c.json({ ok: false, error: "no popup is open" }, 409);
    activateWindow();
    return c.json({ ok: true, tileId: result.tileId, tabId: result.tabId });
  });

  // フォントサイズをキーバインド1回分だけ拡大・縮小、またはconfig値へリセットする
  // （現在の実効フォントサイズをpxで返す。configファイルのappearance.fontSize自体は変更しない）
  app.post("/font-size", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const action = parseFontSizeAction(body);
    if (!action) {
      return c.json(
        { ok: false, error: 'expected { action: "increase" | "decrease" | "reset" }' },
        400,
      );
    }
    const fontSize =
      action === "increase"
        ? increaseFontSize()
        : action === "decrease"
          ? decreaseFontSize()
          : resetFontSize();
    return c.json({ ok: true, fontSize });
  });

  // OSのデスクトップ通知を出す（config内のniwa.notifyと同じ実体）。クリックしてもniwatermへの
  // フォーカス移動は行わない（現時点ではElectrobun側にクリック検知の仕組みが無いための制約）
  app.post("/notify", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseNotifyBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error: "expected { title: string, body?: string, subtitle?: string, silent?: boolean }",
        },
        400,
      );
    }
    sendNotification(parsed);
    return c.json({ ok: true });
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
    workspaceManager.showTab(parsed.tabId);
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

function removeFileIfExists(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // すでに消えている等は無視
  }
}

/**
 * WSLディストロからは path のUnix domain socketへ接続できないため、Windows限定で
 * ループバックとWSL用仮想アダプタのIPに追加でTCP listenする（bridgeBindAddresses参照）。
 * ポート番号は1つ目のlistenでOSに割り当てさせ、2つ目以降は同じ番号を別アドレスで使う
 * （CLIが1つのポート番号だけを見れば済むようにするため）。
 * bind失敗はbest effortで無視する（IPCサーバー本体を巻き込まないため）が、無言で
 * 握り潰すとWSLからCLIが繋がらない原因が分からなくなるため、成否は必ずログに出す
 */
function startWslBridge(app: ReturnType<typeof buildApp>): ReturnType<typeof Bun.serve>[] {
  const servers: ReturnType<typeof Bun.serve>[] = [];
  for (const hostname of bridgeBindAddresses()) {
    try {
      const server = Bun.serve({ hostname, port: servers[0]?.port ?? 0, fetch: app.fetch });
      servers.push(server);
      console.log(`[bun] wsl bridge listening on ${hostname}:${server.port}`);
    } catch (err) {
      console.log(`[bun] failed to listen wsl bridge on ${hostname}: ${String(err)}`);
    }
  }
  return servers;
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
  increaseFontSize: () => number = () => 0,
  decreaseFontSize: () => number = () => 0,
  resetFontSize: () => number = () => 0,
  sendNotification: (opts: NiwaNotifyOptions) => void = () => {},
): Promise<IpcServer> {
  // 置き場所（アプリケーションサポートディレクトリ）は初回起動時には存在しない。
  // 無いままlistenするとENOENTでIPCサーバーだけ起動に失敗する
  await mkdir(dirname(path), { recursive: true });
  await removeStaleSocket(path);
  // 前回のポートが残っているとCLIが古い（あるいは別プロセスが掴んだ）ポートへ繋ぎにいくため、
  // listenして書き直す前に必ず消す
  const portFile = bridgePortFilePath(path);
  removeFileIfExists(portFile);
  const app = buildApp(
    workspaceManager,
    getCustomView,
    activateWindow,
    browserBridge,
    captureScreenshot,
    getShellProfiles,
    getLayouts,
    increaseFontSize,
    decreaseFontSize,
    resetFontSize,
    sendNotification,
  );
  const server = Bun.serve({ unix: path, fetch: app.fetch });
  const tcpServers = process.platform === "win32" ? startWslBridge(app) : [];
  wslBridgePort = tcpServers[0]?.port ?? null;
  if (wslBridgePort !== null) await writeFile(portFile, String(wslBridgePort));
  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      wslBridgePort = null;
      server.stop();
      for (const tcpServer of tcpServers) tcpServer.stop();
      removeFileIfExists(portFile);
      removeFileIfExists(path);
    },
  };
}
