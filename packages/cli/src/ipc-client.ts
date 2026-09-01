// niwatermアプリのIPCサーバーへの接続。
// ソケットパスの解決ロジックはsrc/bun/app-paths.ts・ipc-server.tsと同じ内容だが、
// このパッケージは別ワークスペースパッケージでsrc/bunをimportできないため、意図的に重複させている。
// 片方だけ変更すると接続できなくなるため、変更時は必ず両方を揃えること。
//
// WSL(NixOS等)からは、Windows側アプリのUnix domain socketへ直接接続できない
// （9p/drvfs越しにソケットファイルとして扱えず、Linux側から見るとただの空のregular fileに
// なるため。実機検証済み）。そのためWSL上ではsrc/bun/ipc-server.tsが追加でlistenしている
// TCPブリッジへ接続する。
//
// 開発中ビルド(niwaterm-wip-dev)と普段遣いビルド(niwaterm-daily-dev)を同時に動かすと
// ソケットパス・ブリッジポートがアプリ名別に分かれる（src/bun/app-paths.ts・ipc-server.ts参照）。
// niwatermが起動するPTY内では自インスタンスのNIWATERM_SOCKET/NIWATERM_BRIDGE_PORTが
// 環境変数として渡るため、それを最優先で使う。未設定（niwatermのタブ外から叩いた場合等）は
// 普段遣いインスタンスを見に行く。ソケットパスはアプリ名から決まるが、TCPブリッジのポートは
// OS任せの動的割り当てなので、アプリが書き出したポートファイルを読んで解決する。
//
// ディレクトリ名に使うのはappフォルダ名（"-dev"サフィックス付き）ではなくAPP_VARIANT、つまり
// electrobun.config.tsのapp.nameそのもの（"niwaterm-daily"）である点に注意。ここが
// "niwaterm-daily-dev"だった頃は実在しないパスを見ていたため、NIWATERM_SOCKET未設定の
// 呼び出しが常に接続失敗していた（ipc-server.tsのWSLブリッジポートでも同じ取り違えがあった）。

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * NIWATERM_SOCKET/NIWATERM_BRIDGE_PORT未設定時に見に行くインスタンス。既定は普段遣いのビルド。
 * ブリッジのポートが動的割り当てになったことで、タブ外から開発中ビルドへ繋ぎたいときに
 * ポート番号を調べて渡す手が使えないため、NIWATERM_APP_VARIANTで切り替えられるようにしている
 * （例: NIWATERM_APP_VARIANT=niwaterm-wip niwaterm ping）。
 * この変数はniwaterm自身がPTYへも注入するため、タブ内から叩けば自インスタンスを指す
 * （NIWATERM_BRIDGE_PORTが何らかの理由で空でも、ポートファイル経由で正しい接続先に届く）
 */
function defaultAppVariant(): string {
  return process.env["NIWATERM_APP_VARIANT"] || "niwaterm-daily";
}

function appSupportDir(): string {
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    return join(appData, defaultAppVariant());
  }
  return join(homedir(), "Library", "Application Support", defaultAppVariant());
}

/** NIWATERM_SOCKET未設定時のフォールバック（普段遣いインスタンス相当の固定パス） */
export function ipcSocketPath(): string {
  return join(appSupportDir(), "niwaterm.sock");
}

/**
 * WSLからWindows側の`%APPDATA%`に対応するLinuxパスを解決する。
 * cmd.exeで実際の値を取り、wslpathでLinuxパスへ変換する（`/mnt/c`のマウント位置は
 * /etc/wsl.confのautomount.rootで変えられるため、自前で組み立てず変換コマンドに任せる）。
 * interopが無効な環境などで解決できなければnullを返す
 */
function windowsAppDataFromWsl(): string | null {
  try {
    // cwdがWSL側のパスのままだとcmd.exeがUNCパス警告をstderrへ出すが、stdoutの値は正しい
    const echo = Bun.spawnSync(["cmd.exe", "/c", "echo %APPDATA%"], { stderr: "ignore" });
    const appData = echo.stdout.toString().trim();
    // 未定義の環境変数はcmd.exeが"%APPDATA%"のまま出力する
    if (!echo.success || !appData || appData.startsWith("%")) return null;
    const converted = Bun.spawnSync(["wslpath", "-u", appData], { stderr: "ignore" });
    const path = converted.stdout.toString().trim();
    return converted.success && path ? path : null;
  } catch {
    return null;
  }
}

/**
 * niwatermアプリが書き出したTCPブリッジのポートファイルを読む
 * （src/bun/ipc-server.tsのbridgePortFilePath参照）。
 * ブリッジのポートは他アプリとの衝突を避けるためOSに割り当てさせており固定値がないため、
 * NIWATERM_BRIDGE_PORTが渡っていない場合（niwatermのタブ外から叩いた場合）はこれで解決する。
 * ソケットと違いただのregular fileなので、DrvFs越しでもWSLから読める。
 * どのインスタンスを見るかはdefaultAppVariant()に従う
 */
function readBridgePortFile(): number | null {
  const appData = windowsAppDataFromWsl();
  if (!appData) return null;
  try {
    const raw = readFileSync(join(appData, defaultAppVariant(), "bridge-port"), "utf8");
    const port = Number(raw.trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

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
  | { kind: "tcp"; hosts: string[]; port: number }
  /** 接続先が特定できなかった場合。実際に繋ぎにいく前にreasonをそのままエラーとして返す */
  | { kind: "unavailable"; reason: string };

/**
 * WSLからWindowsホスト側のTCPブリッジへ届くアドレスの候補を、試す順に返す。
 * WSL2のネットワークモードによって到達経路が変わるが、どちらのモードかを
 * 同期的に確実に判定する手段がないため、両方を候補にして順に試す
 * （繋がらない側は即座に接続拒否になるので、実用上の遅延はない）。
 *
 * - `127.0.0.1`: ミラーモード（`.wslconfig`の`networkingMode=mirrored`）用。
 *   このモードではWSL用仮想アダプタのIP（=NATモードのゲートウェイ）へは到達できず、
 *   ループバック経由でWindowsホストのlistenに届く（実機確認済み）
 * - デフォルトゲートウェイ: NATモード（WSL2の既定）用。Windowsホスト側の
 *   WSL用仮想アダプタのIPにあたる
 */
function wslBridgeHosts(): string[] {
  const gateway = wslDefaultGateway();
  return gateway ? ["127.0.0.1", gateway] : ["127.0.0.1"];
}

/**
 * 接続先を解決する。WSL上ではUnix domain socketへ接続できないためTCPブリッジを使い、
 * それ以外（macOS・Windows実機）は従来通りUnix domain socketを使う。
 * niwatermのタブ内シェルから叩く場合はNIWATERM_SOCKET/NIWATERM_BRIDGE_PORTが
 * 自インスタンスの値に設定されているため、それを優先する（未設定時は普段遣い相当にフォールバック）
 */
export function resolveIpcEndpoint(): IpcEndpoint {
  if (isWsl()) {
    const port = Number(process.env["NIWATERM_BRIDGE_PORT"]) || readBridgePortFile();
    if (!port) {
      return {
        kind: "unavailable",
        reason: `WSLからWindows側niwatermアプリ(${defaultAppVariant()})への接続先ポートが分かりませんでした。Windows側でアプリが起動しているか確認してください（起動していれば%APPDATA%\\${defaultAppVariant()}\\bridge-portが作られます）`,
      };
    }
    return { kind: "tcp", hosts: wslBridgeHosts(), port };
  }
  return { kind: "unix", path: process.env["NIWATERM_SOCKET"] || ipcSocketPath() };
}

/**
 * WSL上のCLIからTCPブリッジ経由でWindows側アプリへcwdを渡す際、Linux絶対パス
 * （例: /home/eetann/proj）のままだとWindows側のBun.spawnがそのパスを解決できず
 * ENOENTになる（実機確認済み）。WSLディストロの9pマウント経由でWindowsから参照できる
 * \\wsl.localhost\<distro>\... 形式のUNCパスへ変換する。
 * WSLブリッジ以外（macOS・Windows実機からの直接接続）やWSL_DISTRO_NAME未設定、
 * 絶対パスでない場合はそのまま返す（変換できない時に無理に書き換えない）
 */
function toWindowsAccessibleCwd(endpoint: IpcEndpoint, cwd: string): string {
  if (endpoint.kind !== "tcp") return cwd;
  const distro = process.env["WSL_DISTRO_NAME"];
  if (!distro || !cwd.startsWith("/")) return cwd;
  return `\\\\wsl.localhost\\${distro}${cwd.replaceAll("/", "\\")}`;
}

function ipcUrl(endpoint: IpcEndpoint, path: string): string {
  if (endpoint.kind === "tcp") return `http://${endpoint.hosts[0]}:${endpoint.port}${path}`;
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
 * ipcUrl()が組み立てたURLへ接続する。TCPブリッジは接続先ホストの候補が複数あり
 * （wslBridgeHosts参照）、どれが有効かは実際に繋いでみないと分からないため、
 * 接続に失敗したらURLのホスト部分だけ差し替えて順に試す。
 * 全候補で失敗したら最後のエラーをそのまま投げ、呼び出し側のcatchでdescribeError()に渡す
 */
async function ipcFetch(
  endpoint: IpcEndpoint,
  url: string,
  init: RequestInit & { unix?: string },
): Promise<Response> {
  if (endpoint.kind === "unavailable") throw new Error(endpoint.reason);
  if (endpoint.kind === "unix" || endpoint.hosts.length <= 1) return await fetch(url, init);
  let lastError: unknown;
  for (const host of endpoint.hosts) {
    const target = new URL(url);
    target.hostname = host;
    try {
      return await fetch(target.toString(), init);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
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
  if (endpoint.kind === "unavailable") return endpoint.reason;
  if (endpoint.kind === "unix") {
    if (err instanceof Error && (err as { code?: string }).code === "FailedToOpenSocket") {
      return "アプリが起動していない可能性があります。`mise run start`で起動してから再実行してください";
    }
    return String(err);
  }
  const targets = endpoint.hosts.map((host) => `${host}:${endpoint.port}`).join(" / ");
  return `WSLからWindows側niwatermアプリ(${targets})へ接続できませんでした。Windows側でアプリが起動しているか確認してください（${String(err)}）`;
}

export type PingResult = { ok: true; pid: number } | { ok: false; error: string };

export async function pingNiwaterm(endpoint: IpcEndpoint): Promise<PingResult> {
  try {
    const res = await ipcFetch(endpoint, ipcUrl(endpoint, "/ping"), ipcFetchInit(endpoint));
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

export type BoardId = string;

export interface BoardListEntry {
  boardId: BoardId;
  active: boolean;
  focusedTileId: TileId;
  layout: TileSummary;
  name: string | null;
}

export interface WorkspaceListEntry {
  workspaceId: string;
  active: boolean;
  activeBoardId: BoardId;
  /** このWorkspaceが持つ全Board（ADR 0006）。単一Boardの場合が大半 */
  boards: BoardListEntry[];
  name: string | null;
}

export type ListResult =
  | { ok: true; workspaces: WorkspaceListEntry[] }
  | { ok: false; error: string };

export async function listWorkspaces(endpoint: IpcEndpoint): Promise<ListResult> {
  try {
    const res = await ipcFetch(endpoint, ipcUrl(endpoint, "/list"), ipcFetchInit(endpoint));
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
    const res = await ipcFetch(
      endpoint,
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
    const res = await ipcFetch(
      endpoint,
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
  cwd?: string,
): Promise<SplitTileResult> {
  const body: { tileId: TileId; orientation: SplitOrientation; cwd?: string } = {
    tileId,
    orientation,
  };
  if (cwd !== undefined) body.cwd = toWindowsAccessibleCwd(endpoint, cwd);
  return postJson(endpoint, "/split-tile", body);
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
  if (cwd !== undefined) body.cwd = toWindowsAccessibleCwd(endpoint, cwd);
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

export type RenameWorkspaceResult = { ok: true } | { ok: false; error: string };

export function renameWorkspace(
  endpoint: IpcEndpoint,
  workspaceId: string,
  name: string,
): Promise<RenameWorkspaceResult> {
  return postJson(endpoint, "/rename-workspace", { workspaceId, name });
}

export type NewBoardResult = { ok: true; boardId: string } | { ok: false; error: string };

export function newBoard(
  endpoint: IpcEndpoint,
  workspaceId?: string,
  cwd?: string,
): Promise<NewBoardResult> {
  const body: { workspaceId?: string; cwd?: string } = {};
  if (workspaceId !== undefined) body.workspaceId = workspaceId;
  if (cwd !== undefined) body.cwd = toWindowsAccessibleCwd(endpoint, cwd);
  return postJson(endpoint, "/new-board", body);
}

export type SwitchBoardResult = { ok: true } | { ok: false; error: string };

export function switchBoard(endpoint: IpcEndpoint, boardId: string): Promise<SwitchBoardResult> {
  return postJson(endpoint, "/switch-board", { boardId });
}

export type CloseBoardResult = { ok: true } | { ok: false; error: string };

export function closeBoard(endpoint: IpcEndpoint, boardId: string): Promise<CloseBoardResult> {
  return postJson(endpoint, "/close-board", { boardId });
}

export type RenameBoardResult = { ok: true } | { ok: false; error: string };

export function renameBoard(
  endpoint: IpcEndpoint,
  boardId: string,
  name: string,
): Promise<RenameBoardResult> {
  return postJson(endpoint, "/rename-board", { boardId, name });
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
    const res = await ipcFetch(
      endpoint,
      ipcUrl(endpoint, "/shell-profiles"),
      ipcFetchInit(endpoint),
    );
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
    const res = await ipcFetch(endpoint, ipcUrl(endpoint, "/layouts"), ipcFetchInit(endpoint));
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

export type ApplyLayoutTarget = "new-board" | "replace";

export type ApplyLayoutResult = { ok: true; boardId: string } | { ok: false; error: string };

export function applyLayout(
  endpoint: IpcEndpoint,
  name: string,
  target: ApplyLayoutTarget,
  cwd?: string,
  workspaceId?: string,
  boardId?: string,
): Promise<ApplyLayoutResult> {
  const body: {
    name: string;
    target: ApplyLayoutTarget;
    cwd?: string;
    workspaceId?: string;
    boardId?: string;
  } = { name, target };
  if (cwd !== undefined) body.cwd = toWindowsAccessibleCwd(endpoint, cwd);
  if (workspaceId !== undefined) body.workspaceId = workspaceId;
  if (boardId !== undefined) body.boardId = boardId;
  return postJson(endpoint, "/apply-layout", body);
}

export type OpenPopupResult =
  | { ok: true; tabId: TabId; stdout?: string }
  | { ok: false; error: string };

/**
 * アクティブなワークスペースにポップアップを開く（tmuxのpopup/floating相当）。
 * commandを指定すると、シェルの代わりにそのコマンドを実行し、終了すると自動的にポップアップも閉じる（ワンショット実行）。
 * wait:trueの場合、ポップアップが閉じる（コマンド終了・手動close・昇格いずれも）までレスポンスを待つ。
 * captureStdout:trueの場合、commandの標準出力をキャプチャしてレスポンスのstdoutで返す（waitは暗黙にtrueとなる）
 */
export function openPopup(
  endpoint: IpcEndpoint,
  cwd?: string,
  command?: string,
  width?: number,
  height?: number,
  wait?: boolean,
  captureStdout?: boolean,
): Promise<OpenPopupResult> {
  const body: {
    cwd?: string;
    command?: string;
    width?: number;
    height?: number;
    wait?: boolean;
    captureStdout?: boolean;
  } = {};
  if (cwd !== undefined) body.cwd = toWindowsAccessibleCwd(endpoint, cwd);
  if (command !== undefined) body.command = command;
  if (width !== undefined) body.width = width;
  if (height !== undefined) body.height = height;
  if (wait !== undefined) body.wait = wait;
  if (captureStdout !== undefined) body.captureStdout = captureStdout;
  return postJson(endpoint, "/popup", body);
}

export type ClosePopupResult = { ok: true } | { ok: false; error: string };

/** 開いているポップアップを閉じる */
export function closePopup(endpoint: IpcEndpoint): Promise<ClosePopupResult> {
  return postJson(endpoint, "/close-popup", {});
}

export type TogglePopupResult = { ok: true; visible: boolean } | { ok: false; error: string };

/** ポップアップの表示/非表示を切り替える（PTYは維持したまま）。開いていない場合は失敗する */
export function togglePopupVisibility(endpoint: IpcEndpoint): Promise<TogglePopupResult> {
  return postJson(endpoint, "/toggle-popup", {});
}

export type FontSizeAction = "increase" | "decrease" | "reset";

export type AdjustFontSizeResult = { ok: true; fontSize: number } | { ok: false; error: string };

/** ターミナルのフォントサイズを拡大・縮小・リセットする。configファイルのappearance.fontSizeは変更しない実行時ズーム */
export function adjustFontSize(
  endpoint: IpcEndpoint,
  action: FontSizeAction,
): Promise<AdjustFontSizeResult> {
  return postJson(endpoint, "/font-size", { action });
}

export type PromotePopupResult =
  | { ok: true; tileId: TileId; tabId: TabId }
  | { ok: false; error: string };

/** 開いているポップアップの中身を、フォーカス中タイルへ通常タブとして編入する（ADR 0005） */
export function promotePopup(endpoint: IpcEndpoint): Promise<PromotePopupResult> {
  return postJson(endpoint, "/promote-popup", {});
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

export type RespawnTabResult = { ok: true } | { ok: false; error: string };

/** 指定タブのプロセスを強制終了し、同じtabIdのまま再起動する（tmux respawn-pane -k相当） */
export function respawnTab(
  endpoint: IpcEndpoint,
  tabId: TabId,
  shellProfileId?: string,
  cwd?: string,
  command?: string,
): Promise<RespawnTabResult> {
  const body: { tabId: TabId; shellProfileId?: string; cwd?: string; command?: string } = {
    tabId,
  };
  if (shellProfileId !== undefined) body.shellProfileId = shellProfileId;
  if (cwd !== undefined) body.cwd = toWindowsAccessibleCwd(endpoint, cwd);
  if (command !== undefined) body.command = command;
  return postJson(endpoint, "/respawn-tab", body);
}

export type FocusTileResult = { ok: true } | { ok: false; error: string };

export function focusTile(endpoint: IpcEndpoint, tileId: TileId): Promise<FocusTileResult> {
  return postJson(endpoint, "/focus-tile", { tileId });
}

export type FocusDirection = "up" | "down" | "left" | "right";

export type FocusDirectionResult = { ok: true } | { ok: false; error: string };

export function focusDirection(
  endpoint: IpcEndpoint,
  direction: FocusDirection,
): Promise<FocusDirectionResult> {
  return postJson(endpoint, "/focus-direction", { direction });
}

export type ZoomTileResult = { ok: true; zoomed: boolean } | { ok: false; error: string };

/** 指定タイルの一時的なズーム表示を切り替える（tmuxのresize-pane -Z相当） */
export function zoomTile(endpoint: IpcEndpoint, tileId: TileId): Promise<ZoomTileResult> {
  return postJson(endpoint, "/zoom-tile", { tileId });
}

export type ResizeTileResult = { ok: true } | { ok: false; error: string };

/** 指定タイルを指定方向へ拡大する（tmuxのresize-pane相当）。amount省略時は既定の1ステップ分 */
export function resizeTile(
  endpoint: IpcEndpoint,
  tileId: TileId,
  direction: FocusDirection,
  amount?: number,
): Promise<ResizeTileResult> {
  const body: { tileId: TileId; direction: FocusDirection; amount?: number } = {
    tileId,
    direction,
  };
  if (amount !== undefined) body.amount = amount;
  return postJson(endpoint, "/resize-tile", body);
}

export type CaptureTabResult = { ok: true; text: string } | { ok: false; error: string };

export async function captureTab(endpoint: IpcEndpoint, tabId: TabId): Promise<CaptureTabResult> {
  try {
    const res = await ipcFetch(
      endpoint,
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
    const res = await ipcFetch(
      endpoint,
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
    const res = await ipcFetch(
      endpoint,
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
    const res = await ipcFetch(
      endpoint,
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
    const res = await ipcFetch(
      endpoint,
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
    const res = await ipcFetch(
      endpoint,
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

export type FindTabsByVarResult = { ok: true; tabIds: TabId[] } | { ok: false; error: string };

export async function findTabsByVar(
  endpoint: IpcEndpoint,
  key: string,
  value: string,
  scopeTabId?: TabId,
): Promise<FindTabsByVarResult> {
  try {
    const query = new URLSearchParams({ key, value });
    if (scopeTabId) query.set("scopeTabId", scopeTabId);
    const res = await ipcFetch(
      endpoint,
      ipcUrl(endpoint, `/find-vars?${query}`),
      ipcFetchInit(endpoint),
    );
    const body = (await res.json().catch(() => null)) as {
      tabIds?: unknown;
      error?: unknown;
    } | null;
    if (res.ok && Array.isArray(body?.tabIds)) {
      return { ok: true, tabIds: body.tabIds as TabId[] };
    }
    const error = typeof body?.error === "string" ? body.error : `unexpected status ${res.status}`;
    return { ok: false, error };
  } catch (err) {
    return { ok: false, error: describeError(endpoint, err) };
  }
}

export type SendNotificationResult = { ok: true } | { ok: false; error: string };

export function sendNotification(
  endpoint: IpcEndpoint,
  title: string,
  body?: string,
  subtitle?: string,
  silent?: boolean,
): Promise<SendNotificationResult> {
  return postJson(endpoint, "/notify", { title, body, subtitle, silent });
}
