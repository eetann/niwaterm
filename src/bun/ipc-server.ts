// CLI(niwaterm ping等)からの接続を受け付けるunix socket IPCサーバー。
// Electrobunのアプリコードは他のネイティブモジュール同様Bun Worker内で動くため、
// Bun.serveのunixオプションがWorker内でも動作することはsmoke testで実機確認済み。

import { unlinkSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { Hono, type Context } from "hono";
import type {
  KeybindingsConfig,
  LayoutsConfig,
  NiwaNotifyOptions,
  ResolvedCustomViewConfig,
  ShellProfile,
} from "@niwaterm/config";
import { WORKSPACES_VIEW_ID } from "@niwaterm/config";
import { appSupportDir } from "./app-paths";
import type { BrowserBridge } from "./browser-bridge";
import { captureUrlScreenshot, type ScreenshotResult } from "./browser-screenshot";
import { changeBoardStartup, checkLayoutTrust, startupCwdFields } from "./board-startup";
import type { ConfigSummary } from "./config-summary";
import { applyBuiltinLayout, applyLayoutPreset, type ApplyLayoutTarget } from "./layout-apply";
import { buildKeybindList } from "./keybind-list";
import { listResolvedLayouts, resolveLayoutPresetByName } from "./project-config";
import { DEFAULT_RESIZE_AMOUNT } from "./niwa-api";
import { resolveShellProfileCommand } from "./shell-profiles";
import type { SplitOrientation } from "./tile-layout";
import { tmuxKeysToBytes } from "./tmux-keys";
import type { WindowId, WindowOps } from "./window-manager";
import type { WorkspaceManager } from "./workspace-manager";

const UNAVAILABLE_BROWSER_BRIDGE: BrowserBridge = {
  navigate: async () => ({ ok: false, error: "browser bridge not available" }),
  getText: async () => ({ ok: false, error: "browser bridge not available" }),
  getHtml: async () => ({ ok: false, error: "browser bridge not available" }),
  getUrl: async () => ({ ok: false, error: "browser bridge not available" }),
};

type CaptureScreenshot = (url: string) => Promise<ScreenshotResult>;

/** 対象のcustomViewが見つからないときのエラー文。id省略時は1つも設定されていないケース */
function customViewNotFoundError(viewId: string | undefined): string {
  return viewId === undefined ? "no customViews are configured" : `customView not found: ${viewId}`;
}

/**
 * CLIが全リクエストへ付ける呼び出し元タブのid（PTYへ注入したNIWATERM_TAB_ID）。
 * 「今のウィンドウに対して」という意味を持つ操作（workspace new・popup open等）の起点になる。
 * niwatermの外から叩かれた場合は付かないので、フォーカス中ウィンドウへ落とす
 */
const SCOPE_TAB_HEADER = "x-niwaterm-tab-id";

/** ウィンドウが1つしか無い前提の既定実装（テスト・単体利用向け） */
function singleWindowOps(workspaceManager: WorkspaceManager): WindowOps {
  return {
    newWindow: () => null,
    closeWindow: () => false,
    listWindows: () => [],
    windowIdOfTab: () => null,
    managerOf: () => workspaceManager,
  };
}

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
  /** customView:true のときにどのビューを開くか。省略時は先頭のcustomView */
  customViewId?: string;
  shellProfileId?: string;
  cwd?: string;
}

/**
 * url・customView・shellProfileIdいずれも省略されていればデフォルトシェルのターミナルタブ、
 * urlが指定されていればブラウザタブ（空文字列は不可）、customView:trueが指定されていれば
 * 設定済みのユーザー定義HTML UI（customViewIdで選ぶ。省略時は先頭）を開く、
 * shellProfileIdが指定されていればそのプロファイルの
 * シェルでターミナルタブを開く。3つは互いに排他とする。
 * cwdはターミナルタブ（url・customView未指定）専用のオプションで、url・customViewとは同時指定不可
 */
function parseNewTabBody(body: unknown): NewTabRequestBody | null {
  const tileIdBody = parseTileIdBody(body);
  if (!tileIdBody) return null;
  const b = body as {
    url?: unknown;
    customView?: unknown;
    customViewId?: unknown;
    shellProfileId?: unknown;
    cwd?: unknown;
  };
  const hasUrl = b.url !== undefined;
  const hasCustomView = b.customView !== undefined;
  if (b.customViewId !== undefined && !hasCustomView) return null;
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
    if (b.customViewId !== undefined) {
      if (typeof b.customViewId !== "string" || b.customViewId.length === 0) return null;
      result.customViewId = b.customViewId;
    }
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

interface CycleTabRequestBody extends TileIdRequestBody {
  direction: "next" | "prev";
}

function parseCycleTabBody(body: unknown): CycleTabRequestBody | null {
  const tileIdBody = parseTileIdBody(body);
  if (!tileIdBody) return null;
  const b = body as { direction?: unknown };
  if (b.direction !== "next" && b.direction !== "prev") return null;
  return { ...tileIdBody, direction: b.direction };
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

interface MoveWorkspaceRequestBody extends WorkspaceIdRequestBody {
  direction: "up" | "down";
}

function parseMoveWorkspaceBody(body: unknown): MoveWorkspaceRequestBody | null {
  const workspaceIdBody = parseWorkspaceIdBody(body);
  if (!workspaceIdBody) return null;
  const b = body as { direction?: unknown };
  if (b.direction !== "up" && b.direction !== "down") return null;
  return { ...workspaceIdBody, direction: b.direction };
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
  /** 省略時はtrue（作ったBoardをアクティブにする） */
  activate?: boolean;
  /** このBoardが対応するgitワークツリーの絶対パス（`niwaterm worktree new`・`worktree open`用） */
  worktreePath?: string;
  /** Boardの表示名。空文字列は名前なし（設定board.namingによる自動名）として扱う */
  name?: string;
}

/** workspaceId省略時はgetActiveWorkspaceId()で解決する（エンドポイント側の責務） */
function parseNewBoardBody(body: unknown): NewBoardRequestBody | null {
  const b = body as {
    workspaceId?: unknown;
    cwd?: unknown;
    activate?: unknown;
    worktreePath?: unknown;
    name?: unknown;
  };
  const result: NewBoardRequestBody = {};
  if (b.workspaceId !== undefined) {
    if (typeof b.workspaceId !== "string" || b.workspaceId.length === 0) return null;
    result.workspaceId = b.workspaceId;
  }
  if (b.cwd !== undefined) {
    if (typeof b.cwd !== "string" || b.cwd.length === 0) return null;
    result.cwd = b.cwd;
  }
  if (b.activate !== undefined) {
    if (typeof b.activate !== "boolean") return null;
    result.activate = b.activate;
  }
  if (b.worktreePath !== undefined) {
    if (typeof b.worktreePath !== "string" || b.worktreePath.length === 0) return null;
    result.worktreePath = b.worktreePath;
  }
  if (b.name !== undefined) {
    if (typeof b.name !== "string") return null;
    result.name = b.name;
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

/** `niwaterm board worktree set/clear/show`。boardId省略時はアクティブBoardへ向ける */
interface BoardWorktreeRequestBody {
  boardId?: string;
  mode: "set" | "clear" | "show";
  /** mode: "set"のみ必須。CLI側で絶対パスへ解決済み（WSLからはUNC形式へ変換済み） */
  path?: string;
}

function parseBoardWorktreeBody(body: unknown): BoardWorktreeRequestBody | null {
  const b = body as { boardId?: unknown; mode?: unknown; path?: unknown };
  if (b.mode !== "set" && b.mode !== "clear" && b.mode !== "show") return null;
  const result: BoardWorktreeRequestBody = { mode: b.mode };
  if (b.boardId !== undefined) {
    if (typeof b.boardId !== "string" || b.boardId.length === 0) return null;
    result.boardId = b.boardId;
  }
  if (b.path !== undefined) {
    if (typeof b.path !== "string" || b.path.length === 0) return null;
    result.path = b.path;
  }
  if (b.mode === "set" && result.path === undefined) return null;
  return result;
}

/** `niwaterm board status`。boardId省略時はアクティブBoardへ向ける */
interface BoardStatusRequestBody {
  boardId?: string;
  mode: "set" | "clear" | "show";
  /** mode: "set"のみ必須。board.statusesのidか任意の文字列 */
  status?: string;
}

function parseBoardStatusBody(body: unknown): BoardStatusRequestBody | null {
  const b = body as { boardId?: unknown; mode?: unknown; status?: unknown };
  if (b.mode !== "set" && b.mode !== "clear" && b.mode !== "show") return null;
  const result: BoardStatusRequestBody = { mode: b.mode };
  if (b.boardId !== undefined) {
    if (typeof b.boardId !== "string" || b.boardId.length === 0) return null;
    result.boardId = b.boardId;
  }
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || b.status.trim().length === 0) return null;
    result.status = b.status;
  }
  if (b.mode === "set" && result.status === undefined) return null;
  return result;
}

interface MoveBoardRequestBody extends BoardIdRequestBody {
  direction: "up" | "down";
}

function parseMoveBoardBody(body: unknown): MoveBoardRequestBody | null {
  const boardIdBody = parseBoardIdBody(body);
  if (!boardIdBody) return null;
  const b = body as { direction?: unknown };
  if (b.direction !== "up" && b.direction !== "down") return null;
  return { ...boardIdBody, direction: b.direction };
}

interface MoveBoardToWorkspaceRequestBody extends BoardIdRequestBody {
  workspaceId: string;
}

function parseMoveBoardToWorkspaceBody(body: unknown): MoveBoardToWorkspaceRequestBody | null {
  const boardIdBody = parseBoardIdBody(body);
  if (!boardIdBody) return null;
  const b = body as { workspaceId?: unknown };
  if (typeof b.workspaceId !== "string" || b.workspaceId === "") return null;
  return { ...boardIdBody, workspaceId: b.workspaceId };
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
  /**
   * タブのcwdの基準。cwd・プリセットの解決元のどちらより優先される
   * （`worktree new`・`worktree open`のBoard向け。layout-apply.tsのtabBaseCwd）
   */
  tabCwd?: string;
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
    tabCwd?: unknown;
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
  if (b.tabCwd !== undefined) {
    if (typeof b.tabCwd !== "string" || b.tabCwd.length === 0) return null;
    result.tabCwd = b.tabCwd;
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
  tabId?: string;
}

function parseNotifyBody(body: unknown): NotifyRequestBody | null {
  const b = body as {
    title?: unknown;
    body?: unknown;
    subtitle?: unknown;
    silent?: unknown;
    tabId?: unknown;
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
  if (b.tabId !== undefined) {
    if (typeof b.tabId !== "string") return null;
    result.tabId = b.tabId;
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
  getCustomViews: () => ResolvedCustomViewConfig[],
  activateWindow: (windowId?: WindowId | null) => void,
  browserBridge: BrowserBridge,
  captureScreenshot: CaptureScreenshot,
  getShellProfiles: () => ShellProfile[],
  getLayouts: () => LayoutsConfig,
  increaseFontSize: () => number,
  decreaseFontSize: () => number,
  resetFontSize: () => number,
  sendNotification: (opts: NiwaNotifyOptions) => void,
  getKeybindings: () => KeybindingsConfig,
  getConfigSummary: () => ConfigSummary,
  windowOps: WindowOps,
  setSidebarView: (viewId: string, windowId: WindowId | null) => void,
) {
  const app = new Hono();

  /** 呼び出し元タブが載っているウィンドウ。ヘッダが無ければフォーカス中ウィンドウ */
  function scopeWindowId(c: Context): WindowId | null {
    const tabId = c.req.header(SCOPE_TAB_HEADER);
    return tabId ? windowOps.windowIdOfTab(tabId) : null;
  }

  /** 「今のウィンドウ」に対する操作の宛先。id指定の操作はwindowOpsを介さずworkspaceManagerでよい */
  function scoped(c: Context): WorkspaceManager {
    return windowOps.managerOf(scopeWindowId(c));
  }

  /** そのウィンドウのアクティブなBoard。省略可能な--boardのフォールバックに使う（Board 0個ならundefined） */
  function activeBoardId(c: Context): string | undefined {
    return (
      scoped(c)
        .listWorkspaces()
        .find((w) => w.active)?.activeBoardId ?? undefined
    );
  }

  app.get("/ping", (c) => c.json({ ok: true, pid: process.pid }));

  // 一覧は呼び出し元のウィンドウぶんだけ返す（サイドバーに出ているものと一致させる）。
  // ウィンドウをまたいだ俯瞰は`niwaterm window list`が担う
  app.get("/list", (c) => c.json({ workspaces: scoped(c).listWorkspaces() }));

  app.get("/windows", (c) => c.json({ ok: true, windows: windowOps.listWindows() }));

  // 一時ウィンドウを開く（前回の状態を復元せず、閉じても何も残さない）
  app.post("/new-window", async (c) => {
    const body = await readJsonBody(c);
    const cwd = (body as { cwd?: unknown } | undefined)?.cwd;
    if (cwd !== undefined && (typeof cwd !== "string" || cwd.length === 0)) {
      return c.json({ ok: false, error: "expected { cwd?: string }" }, 400);
    }
    const windowId = windowOps.newWindow(cwd);
    if (!windowId) return c.json({ ok: false, error: "window is not available" }, 409);
    return c.json({ ok: true, windowId });
  });

  app.post("/close-window", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const windowId = (body as { windowId?: unknown }).windowId;
    if (typeof windowId !== "string" || windowId.length === 0) {
      return c.json({ ok: false, error: "expected { windowId: string }" }, 400);
    }
    if (!windowOps.closeWindow(windowId)) {
      return c.json({ ok: false, error: `window not found: ${windowId}` }, 404);
    }
    return c.json({ ok: true });
  });

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
    // 呼び出し元タブが分かるならそのタブのウィンドウ、分からなければフォーカス中ウィンドウが起点
    const owner = windowOps.managerOf(
      scopeTabId ? windowOps.windowIdOfTab(scopeTabId) : scopeWindowId(c),
    );
    const workspaceId = location?.workspaceId ?? owner.getActiveWorkspaceId();
    const boardId =
      location?.boardId ?? owner.listWorkspaces().find((w) => w.active)?.activeBoardId;
    // Board 0個のワークスペースには対象になるタイル・タブが無い（それぞれ404で返す）
    if (!boardId) return c.json({ ok: false, error: "active board not found" }, 404);
    const tileId = location?.tileId ?? owner.getFocusedTileId();
    if (!tileId) return c.json({ ok: false, error: "focused tile not found" }, 404);
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
    const workspaceId = scoped(c).newWorkspace();
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

  // 相対移動のみを受け付ける（絶対位置はサイドバーのD&D・niwa.workspace.move側の関心事）。
  // 端でこれ以上動かせない場合もokを返す（連打が失敗扱いにならないようにするため）
  app.post("/move-workspace", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseMoveWorkspaceBody(body);
    if (!parsed) {
      return c.json(
        { ok: false, error: 'expected { workspaceId: string, direction: "up"|"down" }' },
        400,
      );
    }
    const ok = workspaceManager.moveWorkspaceBy(
      parsed.workspaceId,
      parsed.direction === "up" ? -1 : 1,
    );
    if (!ok) return c.json({ ok: false, error: `workspace not found: ${parsed.workspaceId}` }, 404);
    return c.json({ ok: true });
  });

  app.post("/new-board", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseNewBoardBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error:
            "expected { workspaceId?: string, cwd?: string, activate?: boolean, worktreePath?: string, name?: string }",
        },
        400,
      );
    }
    const workspaceId = parsed.workspaceId ?? scoped(c).getActiveWorkspaceId();
    const boardId = workspaceManager.newBoard(workspaceId, parsed.cwd, {
      ...(parsed.activate !== undefined ? { activate: parsed.activate } : {}),
      ...(parsed.worktreePath !== undefined ? { worktreePath: parsed.worktreePath } : {}),
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    });
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

  // move-workspaceと同じく相対移動のみを受け付け、端でこれ以上動かせない場合もokを返す
  app.post("/move-board", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseMoveBoardBody(body);
    if (!parsed) {
      return c.json(
        { ok: false, error: 'expected { boardId: string, direction: "up"|"down" }' },
        400,
      );
    }
    const ok = workspaceManager.moveBoardBy(parsed.boardId, parsed.direction === "up" ? -1 : 1);
    if (!ok) return c.json({ ok: false, error: `board not found: ${parsed.boardId}` }, 404);
    return c.json({ ok: true });
  });

  // 移動先ワークスペース内での挿入位置は受け付けず常に末尾へ付ける（位置を細かく決めたいなら
  // 移動後にmove-boardで並び替える。GUIのD&Dと違いCLIには「どの行の間か」という文脈が無いため）。
  // 移動元が空になる場合はそのワークスペースごと畳み、その旨をレスポンスで返す
  app.post("/move-board-to-workspace", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseMoveBoardToWorkspaceBody(body);
    if (!parsed) {
      return c.json({ ok: false, error: "expected { boardId: string, workspaceId: string }" }, 400);
    }
    const result = workspaceManager.moveBoardToWorkspace(parsed.boardId, parsed.workspaceId);
    if (!result.ok) {
      const error =
        result.reason === "board-not-found"
          ? `board not found: ${parsed.boardId}`
          : `workspace not found: ${parsed.workspaceId}`;
      return c.json({ ok: false, error }, 404);
    }
    return c.json({ ok: true });
  });

  app.get("/shell-profiles", (c) => c.json({ ok: true, profiles: getShellProfiles() }));

  app.get("/keybindings", (c) => c.json({ ok: true, ...buildKeybindList(getKeybindings()) }));

  // 現在有効な設定値の一覧（`niwaterm config show`）。キーバインドの個々の割り当ては
  // /keybindingsの担当で、ここには件数だけが載る
  app.get("/config", (c) => c.json({ ok: true, ...getConfigSummary() }));

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
    const denied = checkLayoutTrust(
      parsed.startup === true,
      resolved.projectRoot,
      parsed.trust,
      parsed.name,
    );
    if (denied) return c.json({ ok: false, ...denied });

    const target = parsed.target ?? "new-board";
    let boardId: string;
    if (target === "new-board") {
      const workspaceId = parsed.workspaceId ?? scoped(c).getActiveWorkspaceId();
      const newId = workspaceManager.newBoard(workspaceId, parsed.cwd);
      if (newId === null) {
        return c.json({ ok: false, error: `workspace not found: ${workspaceId}` }, 404);
      }
      boardId = newId;
    } else {
      const resolvedBoardId = parsed.boardId ?? activeBoardId(c);
      if (!resolvedBoardId || !workspaceManager.hasBoard(resolvedBoardId)) {
        return c.json({ ok: false, error: `board not found: ${resolvedBoardId ?? ""}` }, 404);
      }
      boardId = resolvedBoardId;
    }

    const result =
      resolved.kind === "builtin"
        ? applyBuiltinLayout(workspaceManager, resolved.name, boardId)
        : applyLayoutPreset(
            workspaceManager,
            getShellProfiles(),
            resolved.preset,
            target,
            boardId,
            {
              ...(parsed.cwd !== undefined ? { invocationCwd: parsed.cwd } : {}),
              ...(resolved.projectRoot ? { projectRoot: resolved.projectRoot } : {}),
              ...(parsed.tabCwd !== undefined ? { tabBaseCwd: parsed.tabCwd } : {}),
            },
          );
    if (!result.ok) return c.json({ ok: false, error: result.error }, 400);
    // どのプリセットから生えたBoardかを記録しておく。--startup指定時のみ
    // 起動時の組み直し対象になり、それ以外は名前を覚えるだけで従来どおり骨格を復元する。
    // 解決元（プロジェクトローカル）と実行ディレクトリも一緒に記録する（起動時にはcwdが無いため）
    workspaceManager.setBoardStartup(result.boardId, {
      preset: parsed.name,
      restoreMode: parsed.startup ? "layout" : "restore",
      ...startupCwdFields(resolved.projectRoot, parsed.cwd),
      ...(parsed.tabCwd !== undefined ? { tabCwd: parsed.tabCwd } : {}),
    });
    return c.json({
      ok: true,
      boardId: result.boardId,
      ...(resolved.projectRoot ? { projectRoot: resolved.projectRoot } : {}),
    });
  });

  app.post("/board-worktree", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseBoardWorktreeBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error: 'expected { mode: "set"|"clear"|"show", boardId?: string, path?: string }',
        },
        400,
      );
    }
    const boardId = parsed.boardId ?? activeBoardId(c);
    if (!boardId || !workspaceManager.hasBoard(boardId)) {
      return c.json({ ok: false, error: `board not found: ${parsed.boardId ?? ""}` }, 404);
    }
    if (parsed.mode === "set") {
      workspaceManager.setBoardWorktreePath(boardId, parsed.path as string);
    } else if (parsed.mode === "clear") {
      workspaceManager.setBoardWorktreePath(boardId, null);
    }
    // missingは存在チェックのキャッシュ越し（listWorkspaces）に引く。setした直後はまだ未チェックで
    // 必ずfalseになるが、CLIの用途では「今まさに指定したパス」なので実害がない
    const entry = workspaceManager
      .listWorkspaces()
      .flatMap((w) => w.boards)
      .find((b) => b.boardId === boardId);
    return c.json({
      ok: true,
      boardId,
      worktreePath: entry?.worktreePath ?? null,
      missing: entry?.worktreeMissing ?? false,
    });
  });

  app.post("/board-status", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseBoardStatusBody(body);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error: 'expected { mode: "set"|"clear"|"show", boardId?: string, status?: string }',
        },
        400,
      );
    }
    const boardId = parsed.boardId ?? activeBoardId(c);
    if (!boardId || !workspaceManager.hasBoard(boardId)) {
      return c.json({ ok: false, error: `board not found: ${parsed.boardId ?? ""}` }, 404);
    }
    if (parsed.mode === "set") {
      workspaceManager.setBoardStatus(boardId, parsed.status as string);
    } else if (parsed.mode === "clear") {
      workspaceManager.setBoardStatus(boardId, null);
    }
    return c.json({ ok: true, boardId, status: workspaceManager.getBoardStatus(boardId) });
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
    const boardId = parsed.boardId ?? activeBoardId(c);
    if (!boardId) {
      return c.json({ ok: false, error: `board not found: ${parsed.boardId ?? ""}` }, 404);
    }
    const result = await changeBoardStartup(workspaceManager, getLayouts(), {
      boardId,
      mode: parsed.mode,
      ...(parsed.preset !== undefined ? { preset: parsed.preset } : {}),
      ...(parsed.cwd !== undefined ? { cwd: parsed.cwd } : {}),
      ...(parsed.trust !== undefined ? { trust: parsed.trust } : {}),
    });
    if (!result.ok) {
      const body = {
        ok: false as const,
        error: result.error,
        ...(result.needsTrust ? { needsTrust: result.needsTrust } : {}),
      };
      // trust待ちは失敗ではなく「同意を取って再送してほしい」という応答なので200で返す
      return result.status ? c.json(body, result.status) : c.json(body);
    }
    return c.json({ ok: true, boardId: result.boardId, startup: result.startup });
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
            "expected { tileId: string, url?: string, customView?: boolean, customViewId?: string, shellProfileId?: string, cwd?: string } (url, customView, shellProfileId are mutually exclusive; customViewId requires customView; cwd is only valid for terminal tabs)",
        },
        400,
      );
    }
    if (parsed.customView) {
      const customViews = getCustomViews();
      const customView =
        parsed.customViewId === undefined
          ? customViews[0]
          : customViews.find((view) => view.id === parsed.customViewId);
      if (!customView) {
        return c.json({ ok: false, error: customViewNotFoundError(parsed.customViewId) }, 400);
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

  app.post("/cycle-tab", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const parsed = parseCycleTabBody(body);
    if (!parsed) {
      return c.json(
        { ok: false, error: 'expected { tileId: string, direction: "next"|"prev" }' },
        400,
      );
    }
    const ok = workspaceManager.cycleTab(parsed.tileId, parsed.direction === "next" ? 1 : -1);
    if (!ok) {
      return c.json({ ok: false, error: `tile not found (or single tab): ${parsed.tileId}` }, 404);
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
    scoped(c).focusDirection(parsed.direction);
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
  // （layout-apply.tsのsendInitialCommand・delay）、その時点でアクティブBoardが
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
    boardId ??= activeBoardId(c);
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
    const popupOwner = scoped(c);
    const tabId = popupOwner.openPopup(parsed);
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
      const output = await popupOwner.waitForPopupClose();
      if (parsed.captureStdout) return c.json({ ok: true, tabId, stdout: output ?? "" });
    }
    return c.json({ ok: true, tabId });
  });

  app.post("/close-popup", (c) => {
    const ok = scoped(c).closePopup();
    if (!ok) return c.json({ ok: false, error: "no popup is open" }, 409);
    return c.json({ ok: true });
  });

  app.post("/toggle-popup", (c) => {
    const visible = scoped(c).togglePopupVisibility();
    if (visible === null) return c.json({ ok: false, error: "no popup is open" }, 409);
    return c.json({ ok: true, visible });
  });

  // ポップアップの中身をフォーカス中タイルへ通常タブとして編入する（タブへ昇格。ADR 0005）。
  // PTYセッションは作り直さないため、workspaceManager.promotePopup()はセッション生成を伴わない
  app.post("/promote-popup", (c) => {
    const result = scoped(c).promotePopup();
    if (!result) return c.json({ ok: false, error: "no popup is open" }, 409);
    activateWindow(scopeWindowId(c));
    return c.json({ ok: true, tileId: result.tileId, tabId: result.tabId });
  });

  // サイドバーに出すビューを切り替える（ワークスペース一覧・各customView）。表示状態はwebview側が
  // 持つため、ここでは存在するidかだけを確かめて呼び出し元のウィンドウへ流す
  app.post("/sidebar-view", async (c) => {
    const body = await readJsonBody(c);
    if (body === undefined) return c.json({ ok: false, error: "invalid JSON body" }, 400);
    const viewId = (body as { viewId?: unknown }).viewId;
    if (typeof viewId !== "string" || viewId.length === 0) {
      return c.json({ ok: false, error: "expected { viewId: string }" }, 400);
    }
    if (viewId !== WORKSPACES_VIEW_ID && !getCustomViews().some((view) => view.id === viewId)) {
      return c.json({ ok: false, error: customViewNotFoundError(viewId) }, 404);
    }
    setSidebarView(viewId, scopeWindowId(c));
    return c.json({ ok: true, viewId });
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
          error:
            "expected { title: string, body?: string, subtitle?: string, silent?: boolean, tabId?: string }",
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
    // そのタブが載っているウィンドウを前面に出す（別ウィンドウのタブを指されることもある）
    activateWindow(windowOps.windowIdOfTab(parsed.tabId));
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
 * Bun.serveの既定のidleTimeout（10秒）を無効化する。`popup open --wait`・`--capture-stdout`は
 * ポップアップが閉じるまでレスポンスを返さない＝その間コネクションに一切データが流れないため、
 * 既定のままだと利用者がポップアップ内で10秒以上操作した時点でサーバー側から接続が切られ、
 * CLIが失敗扱いになる（fzf-niwatermならローカルfzfへのフォールバックが走り、fzfが二重に起動する）。
 * 待ち時間の上限は利用者の操作次第でいくらでも伸びるので、上限そのものを設けない。
 * 詳細: docs/known-issues/long-waiting-ipc-request-is-cut-at-10-seconds.md
 */
const IPC_SERVE_IDLE_TIMEOUT = 0;

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
      const server = Bun.serve({
        hostname,
        port: servers[0]?.port ?? 0,
        idleTimeout: IPC_SERVE_IDLE_TIMEOUT,
        fetch: app.fetch,
      });
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
  getCustomViews: () => ResolvedCustomViewConfig[] = () => [],
  activateWindow: (windowId?: WindowId | null) => void = () => {},
  browserBridge: BrowserBridge = UNAVAILABLE_BROWSER_BRIDGE,
  captureScreenshot: CaptureScreenshot = captureUrlScreenshot,
  getShellProfiles: () => ShellProfile[] = () => [],
  getLayouts: () => LayoutsConfig = () => ({}),
  increaseFontSize: () => number = () => 0,
  decreaseFontSize: () => number = () => 0,
  resetFontSize: () => number = () => 0,
  sendNotification: (opts: NiwaNotifyOptions) => void = () => {},
  getKeybindings: () => KeybindingsConfig = () => ({}),
  getConfigSummary: () => ConfigSummary = () => ({
    configFile: "",
    configFileLoaded: false,
    loadError: null,
    diagnostics: [],
    sections: [],
  }),
  windowOps: WindowOps = singleWindowOps(workspaceManager),
  setSidebarView: (viewId: string, windowId: WindowId | null) => void = () => {},
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
    getCustomViews,
    activateWindow,
    browserBridge,
    captureScreenshot,
    getShellProfiles,
    getLayouts,
    increaseFontSize,
    decreaseFontSize,
    resetFontSize,
    sendNotification,
    getKeybindings,
    getConfigSummary,
    windowOps,
    setSidebarView,
  );
  const server = Bun.serve({ unix: path, idleTimeout: IPC_SERVE_IDLE_TIMEOUT, fetch: app.fetch });
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
