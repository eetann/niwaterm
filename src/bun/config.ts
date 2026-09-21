// ユーザー設定ファイル（~/.config/niwaterm/niwaterm.config.ts）の読み込み。
// ファイル不在・importエラー・スキーマ不一致いずれでも例外を投げずnullを返す（persistence.tsのloadPersistedStateと同じ設計）。

import { rmSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultAppearance,
  defaultBrowserConfig,
  defaultMouseConfig,
  isKeybindAction,
  isTabBarMode,
  type KeybindingsConfig,
  type LayoutPreset,
  type LayoutsConfig,
  type Niwa,
  type NiwaBellEvent,
  type NiwaBellHandler,
  type NiwaNotifyOptions,
  type NiwatermConfig,
  parseKeyBindingString,
  parseSecondKeyString,
  platformDefaultKeybindings,
  resolveBindingEntry,
  type ResolvedAppearanceConfig,
  type ResolvedBrowserConfig,
  type ResolvedCustomViewConfig,
  type ResolvedMouseConfig,
  type SelectionMenuFn,
  type ShellProfile,
} from "@niwaterm/config";
import { APP_VARIANT } from "./app-variant.generated";
import { resolveBackgroundImage } from "./background-image";
import { getWslBridgePort, ipcSocketPath } from "./ipc-server";
import { createNiwaApi, type NiwaApiHandle } from "./niwa-api";
import { createSelectionMenu, type SelectionMenuHandle } from "./selection-menu";
import type { WorkspaceManager } from "./workspace-manager";

export function configDirPath(): string {
  return join(homedir(), ".config", "niwaterm");
}

export function configFilePath(): string {
  return join(configDirPath(), "niwaterm.config.ts");
}

function isNiwatermConfig(value: unknown): value is NiwatermConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if ("keybindings" in v) {
    const kb = v["keybindings"];
    if (typeof kb !== "function" && (typeof kb !== "object" || kb === null)) return false;
  }
  if ("appearance" in v) {
    const ap = v["appearance"];
    if (typeof ap !== "object" || ap === null) return false;
  }
  if ("browser" in v) {
    const br = v["browser"];
    if (typeof br !== "object" || br === null) return false;
  }
  if ("customView" in v) {
    const cv = v["customView"];
    if (typeof cv !== "object" || cv === null) return false;
  }
  if ("shell" in v) {
    const sh = v["shell"];
    if (typeof sh !== "object" || sh === null) return false;
  }
  if ("layouts" in v) {
    const la = v["layouts"];
    if (typeof la !== "object" || la === null) return false;
  }
  if ("mouse" in v) {
    const mo = v["mouse"];
    if (typeof mo !== "object" || mo === null) return false;
  }
  if ("workspace" in v) {
    const ws = v["workspace"];
    if (typeof ws !== "object" || ws === null) return false;
  }
  return true;
}

// 前回importFreshConfigで使った一時ディレクトリを、コピー元ディレクトリごとに1つ覚えておき、
// 次回そのディレクトリの読み込みへ成功したときに削除する
// （importが失敗する可能性があるファイルを即座には消さず、常に「最後にimportへ成功した」ものを1世代分だけ残す）。
// グローバル設定とプロジェクトローカル設定（複数リポジトリぶん）を並行して読むため、
// 単一スロットではなくコピー元パスをキーにしたMapで管理する（互いの世代を消し合わないようにする）
const previousImportDirs = new Map<string, string>();

/**
 * configDirPath()配下のソースファイル（.ts/.js等）を毎回新しい一時ディレクトリへ実体コピーしてから
 * importする。Bunのimport()はURL単位でキャッシュされるため、エントリファイルにクエリ文字列を
 * 付けるだけではエントリファイルは再読み込みされても、そのファイルが相対importする非エントリの
 * ファイル（クエリなしの同じURL）は古い内容のままキャッシュされ続けてしまう。ディレクトリごと
 * 差し替えることでimportツリー全体を新しいURLの下に置き、再読み込みさせる。
 * node_modulesは巨大になりうるためコピーせずシンボリックリンクで繋ぐ（@niwaterm/config等の
 * パッケージimportの解決に必要）。
 */
export async function importFreshConfig(path: string): Promise<unknown> {
  const dir = dirname(path);
  const entryName = basename(path);
  const importDir = await mkdtemp(join(tmpdir(), "niwaterm-config-"));
  try {
    await copyConfigSources(dir, importDir);
    const mod: unknown = await import(pathToFileURL(join(importDir, entryName)).href);
    const staleDir = previousImportDirs.get(dir);
    previousImportDirs.set(dir, importDir);
    if (staleDir) {
      await rm(staleDir, { recursive: true, force: true }).catch(() => {});
    }
    return mod;
  } catch (err) {
    await rm(importDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * node_modulesはシンボリックリンク、それ以外のファイル・ディレクトリは再帰的に実体コピーする。
 * エントリ自体がシンボリックリンク（dotfiles管理等でniwaterm.config.ts等をリンクしている場合）だと
 * Dirent.isFile()/isDirectory()はリンク先をフォローせずどちらもfalseになるため、statでリンク先の
 * 種別を判定してからコピーする。
 */
async function copyConfigSources(srcDir: string, destDir: string): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = join(srcDir, entry.name);
      const destPath = join(destDir, entry.name);
      if (entry.name === "node_modules") {
        await symlink(srcPath, destPath, "dir");
        return;
      }
      const isDir = entry.isSymbolicLink()
        ? (await stat(srcPath)).isDirectory()
        : entry.isDirectory();
      if (isDir) {
        await mkdir(destPath, { recursive: true });
        await copyConfigSources(srcPath, destPath);
        return;
      }
      await copyFile(srcPath, destPath);
    }),
  );
}

/** アプリ終了時に一時importディレクトリを片付ける（index.tsのcleanup()から呼ぶ） */
export function cleanupConfigImportDir(): void {
  for (const dir of previousImportDirs.values()) {
    rmSync(dir, { recursive: true, force: true });
  }
  previousImportDirs.clear();
}

/**
 * ファイル不在・importエラー・exportがNiwatermConfigの形をしていない、いずれでも例外を投げずnullを返す。
 * 一時ディレクトリへソースをコピーしてからimportし、毎回ファイルツリーの最新内容を読み込む（ホットリロード対応）。
 */
export async function loadUserConfig(path: string): Promise<NiwatermConfig | null> {
  try {
    if (!(await Bun.file(path).exists())) return null;
    const mod = await importFreshConfig(path);
    const candidate = (mod as { default?: unknown }).default ?? mod;
    if (!isNiwatermConfig(candidate)) {
      console.log(`[bun] config file did not export a valid NiwatermConfig: ${path}`);
      return null;
    }
    return candidate;
  } catch (err) {
    console.log(`[bun] failed to load config file: ${String(err)}`);
    return null;
  }
}

/**
 * プラットフォームのデフォルトキーバインドをniwa.keybind経由で登録した後、ユーザー設定を重ねて
 * 最終値を返す。ユーザー設定が関数（KeybindingsFn、推奨）ならniwaを渡してそのまま実行し、
 * niwa.keybind/unbind呼び出しで自由にデフォルトを上書き・追加できる。オブジェクト形式（従来のKeybindingsConfig）
 * の場合は各エントリをniwa.keybind呼び出しへ変換する（フィールド・エントリ単位で検証し、
 * 1箇所のtypoで全キーバインドがデフォルトに落ちるのを防ぐのは従来と同じ方針）。
 */
export function resolveKeybindings(
  userConfig: NiwatermConfig | null,
  niwaApi: NiwaApiHandle,
): KeybindingsConfig {
  const platformDefault = platformDefaultKeybindings(process.platform);
  applyKeybindingsObject(niwaApi.niwa, platformDefault, "defaultKeybindings");

  const user = userConfig?.keybindings;
  if (typeof user === "function") {
    user(niwaApi.niwa);
  } else if (user) {
    applyKeybindingsObject(niwaApi.niwa, user, "keybindings");
  }

  return niwaApi.extractKeybindingsConfig();
}

/** KeybindingsConfig（prefix/bindings/direct/repeatTimeoutMs）の内容をniwa.keybind呼び出し列に変換して登録する */
function applyKeybindingsObject(niwa: Niwa, config: KeybindingsConfig, source: string): void {
  if (config.prefix !== undefined) {
    if (parseKeyBindingString(config.prefix)) {
      niwa.prefix(config.prefix);
    } else {
      console.log(`[bun] ignoring invalid ${source}.prefix: "${String(config.prefix)}"`);
    }
  }
  if (config.repeatTimeoutMs !== undefined) {
    if (typeof config.repeatTimeoutMs === "number" && config.repeatTimeoutMs > 0) {
      niwa.repeatTimeout(config.repeatTimeoutMs);
    } else {
      console.log(
        `[bun] ignoring invalid ${source}.repeatTimeoutMs: "${String(config.repeatTimeoutMs)}"`,
      );
    }
  }
  for (const [key, rawEntry] of Object.entries(config.bindings ?? {})) {
    if (rawEntry === undefined) continue;
    const resolved = resolveBindingEntry(rawEntry);
    if (!parseSecondKeyString(key) || !resolved || !isKeybindAction(resolved.target)) {
      console.log(
        `[bun] ignoring invalid ${source}.bindings entry: "${key}" -> ${JSON.stringify(rawEntry)}`,
      );
      continue;
    }
    niwa.keybind(key, resolved.target, {
      repeat: resolved.repeat,
      description: resolved.description,
    });
  }
  for (const [key, rawEntry] of Object.entries(config.direct ?? {})) {
    if (rawEntry === undefined) continue;
    const resolved = resolveBindingEntry(rawEntry);
    if (!parseKeyBindingString(key) || !resolved || !isKeybindAction(resolved.target)) {
      console.log(
        `[bun] ignoring invalid ${source}.direct entry: "${key}" -> ${JSON.stringify(rawEntry)}`,
      );
      continue;
    }
    niwa.keybind(key, resolved.target, {
      noPrefix: true,
      repeat: resolved.repeat,
      description: resolved.description,
    });
  }
}

function resolveField<T>(
  section: string,
  fieldName: string,
  userValue: unknown,
  defaultValue: T,
  isValid: (v: unknown) => v is T,
): T {
  if (userValue === undefined) return defaultValue;
  if (isValid(userValue)) return userValue;
  console.log(`[bun] ignoring invalid ${section}.${fieldName}: ${String(userValue)}`);
  return defaultValue;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && value > 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isOpacity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * defaultAppearanceにユーザー設定をマージし、フィールド単位・ansiColorsはindex単位で
 * 不正値を警告付きで除外した最終値を返す（resolveKeybindingsと同じper-entry方針）。
 */
export function resolveAppearance(userConfig: NiwatermConfig | null): ResolvedAppearanceConfig {
  const user = userConfig?.appearance;

  const ansiColors = [...defaultAppearance.ansiColors];
  if (user?.ansiColors !== undefined) {
    for (let i = 0; i < ansiColors.length; i++) {
      const color = user.ansiColors[i];
      if (color === undefined) continue;
      if (isNonEmptyString(color)) {
        ansiColors[i] = color;
      } else {
        console.log(`[bun] ignoring invalid appearance.ansiColors[${i}]: ${String(color)}`);
      }
    }
  }

  return {
    fontFamily: resolveField(
      "appearance",
      "fontFamily",
      user?.fontFamily,
      defaultAppearance.fontFamily,
      isNonEmptyString,
    ),
    fontSize: resolveField(
      "appearance",
      "fontSize",
      user?.fontSize,
      defaultAppearance.fontSize,
      isPositiveNumber,
    ),
    lineHeight: resolveField(
      "appearance",
      "lineHeight",
      user?.lineHeight,
      defaultAppearance.lineHeight,
      isPositiveNumber,
    ),
    foreground: resolveField(
      "appearance",
      "foreground",
      user?.foreground,
      defaultAppearance.foreground,
      isNonEmptyString,
    ),
    background: resolveField(
      "appearance",
      "background",
      user?.background,
      defaultAppearance.background,
      isNonEmptyString,
    ),
    backgroundOpacity: resolveField(
      "appearance",
      "backgroundOpacity",
      user?.backgroundOpacity,
      defaultAppearance.backgroundOpacity,
      isOpacity,
    ),
    backgroundImage: resolveBackgroundImage(
      resolveField(
        "appearance",
        "backgroundImage",
        user?.backgroundImage,
        defaultAppearance.backgroundImage,
        isNonEmptyString,
      ),
    ),
    ansiColors,
    tabBar: resolveField(
      "appearance",
      "tabBar",
      user?.tabBar,
      defaultAppearance.tabBar,
      isTabBarMode,
    ),
  };
}

/**
 * defaultBrowserConfigにユーザー設定をマージした最終値を返す（resolveAppearanceと同じper-field方針）。
 */
export function resolveBrowser(userConfig: NiwatermConfig | null): ResolvedBrowserConfig {
  const user = userConfig?.browser;
  return {
    defaultUrl: resolveField(
      "browser",
      "defaultUrl",
      user?.defaultUrl,
      defaultBrowserConfig.defaultUrl,
      isNonEmptyString,
    ),
  };
}

/**
 * defaultMouseConfigにユーザー設定をマージした最終値を返す（resolveAppearanceと同じper-field方針）。
 */
export function resolveMouse(userConfig: NiwatermConfig | null): ResolvedMouseConfig {
  const user = userConfig?.mouse;
  return {
    copyOnSelect: resolveField(
      "mouse",
      "copyOnSelect",
      user?.copyOnSelect,
      defaultMouseConfig.copyOnSelect,
      isBoolean,
    ),
  };
}

/**
 * mouse.selectionMenuを取り出す。未設定・関数以外はnull（右クリックメニューは組み込み項目だけになる）。
 * 関数の中身は右クリックのたびに評価されるため、ここでは型だけを確かめる
 */
export function resolveSelectionMenu(userConfig: NiwatermConfig | null): SelectionMenuFn | null {
  const fn = userConfig?.mouse?.selectionMenu;
  if (fn === undefined) return null;
  if (typeof fn !== "function") {
    console.log(`[bun] ignoring invalid mouse.selectionMenu: ${String(fn)}`);
    return null;
  }
  return fn;
}

/**
 * ユーザー定義HTML UI設定を解決する。未設定ならnull（機能オフ）。
 * pathが有効ならconfigDirPath()基準でfile://に解決し、無ければurlをそのまま使う。
 * どちらも無効なら警告して機能オフ（nullを返す）。nameは省略時"Custom View"にフォールバックする。
 */
export function resolveCustomView(
  userConfig: NiwatermConfig | null,
): ResolvedCustomViewConfig | null {
  const user = userConfig?.customView;
  if (!user) return null;

  const name = isNonEmptyString(user.name) ? user.name : "Custom View";

  if (isNonEmptyString(user.path)) {
    const resolvedPath = resolve(configDirPath(), user.path);
    return { name, url: pathToFileURL(resolvedPath).href };
  }
  if (isNonEmptyString(user.url)) {
    return { name, url: user.url };
  }
  console.log("[bun] customView requires either path or url; ignoring");
  return null;
}

/**
 * 新規タブ作成時に使うデフォルトシェルを解決する。未指定・不正値はundefined
 * （pty.ts側のOS標準シェルにフォールバックする。appearance/browserと異なりOS共通の
 * 既定値を持たないため、defaultAppearanceのような具体的なデフォルト定数は無い）。
 */
export function resolveShell(userConfig: NiwatermConfig | null): string | undefined {
  const user = userConfig?.shell?.default;
  if (user === undefined) return undefined;
  if (isNonEmptyString(user)) return user;
  console.log(`[bun] ignoring invalid shell.default: ${String(user)}`);
  return undefined;
}

/**
 * 新規ワークスペース作成時に使うデフォルトcwdを解決する。未指定・不正値はundefined
 * （pty.ts側のOS標準ホームディレクトリにフォールバックする。resolveShellと同じ方針で
 * 具体的なデフォルト定数は持たない）。
 */
export function resolveWorkspaceDefaultCwd(userConfig: NiwatermConfig | null): string | undefined {
  const user = userConfig?.workspace?.defaultCwd;
  if (user === undefined) return undefined;
  if (isNonEmptyString(user)) return user;
  console.log(`[bun] ignoring invalid workspace.defaultCwd: ${String(user)}`);
  return undefined;
}

/** 英数字・_・-・. のみ、1〜64文字。CLI --shellやRPCでの指定値として扱いやすい形式に絞る */
const SHELL_PROFILE_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

function isValidShellProfile(value: unknown): value is ShellProfile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNonEmptyString(v["id"]) &&
    SHELL_PROFILE_ID_PATTERN.test(v["id"]) &&
    isNonEmptyString(v["name"]) &&
    isNonEmptyString(v["command"])
  );
}

/**
 * 自動検出プロファイル（Windows起動時のWSLディストロ・PowerShell等）とユーザー設定の
 * shell.profilesをidベースでマージする。同じidが両方にある場合はユーザー設定側が優先
 * （自動検出結果の上書き・SSH先等の追加を両立させるため）。
 * 不正なプロファイル（id/name/command欠如、id形式不正）は警告付きでスキップする。
 */
export function resolveShellProfiles(
  userConfig: NiwatermConfig | null,
  detected: ShellProfile[],
): ShellProfile[] {
  const byId = new Map<string, ShellProfile>();
  for (const profile of detected) {
    byId.set(profile.id, profile);
  }
  const userProfiles = userConfig?.shell?.profiles;
  if (userProfiles !== undefined) {
    if (Array.isArray(userProfiles)) {
      for (const profile of userProfiles) {
        if (isValidShellProfile(profile)) {
          byId.set(profile.id, profile);
        } else {
          console.log(`[bun] ignoring invalid shell.profiles entry: ${JSON.stringify(profile)}`);
        }
      }
    } else {
      console.log(`[bun] ignoring invalid shell.profiles: ${String(userProfiles)}`);
    }
  }
  return [...byId.values()];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * レイアウトプリセット設定を解決する。TypeScript設定ファイルのため大半の形状はコンパイル時に
 * 保証される想定で、ここではプリセット単位の存在チェック（`layout`フィールドを持つオブジェクトか）
 * のみ行い、不正なプリセットは警告付きで個別にスキップする（1箇所のtypoで全体がデフォルトに
 * 落ちるのを防ぐ、他のresolveXと同じper-entry方針）。タイル木構造の意味的な検証
 * （ratio範囲・shellProfile存在確認・focus重複等）は実行時の状態に依存するためapply時
 * （layout-apply.ts）に行う
 */
export function resolveLayouts(userConfig: NiwatermConfig | null): LayoutsConfig {
  return normalizeLayouts(userConfig?.layouts, "layouts");
}

/**
 * resolveLayoutsの実体。プロジェクトローカル設定（project-config.ts）からも
 * 同じ検証を使えるよう、NiwatermConfigではなくlayoutsの生値を受け取る形で切り出している。
 * sourceは警告ログに出す出所（"layouts" / "<projectRoot>/.niwaterm/config.ts layouts"）
 */
export function normalizeLayouts(user: unknown, source: string): LayoutsConfig {
  if (user === undefined) return {};
  if (!isPlainObject(user)) {
    console.log(`[bun] ignoring invalid ${source}: ${String(user)}`);
    return {};
  }
  const result: LayoutsConfig = {};
  for (const [name, preset] of Object.entries(user)) {
    if (!isPlainObject(preset) || !isPlainObject(preset["layout"])) {
      console.log(`[bun] ignoring invalid ${source} entry: ${name}`);
      continue;
    }
    result[name] = preset as unknown as LayoutPreset;
  }
  return result;
}

/**
 * 設定ファイルを読み込み、キーバインド・外観・ブラウザ・カスタムビュー・シェル設定を解決する（起動時・ホットリロード時共通）。
 * detectedShellProfilesはOS依存の非同期処理（Windows起動時のwsl.exe呼び出し等）を伴うため、
 * このモジュールでは扱わず呼び出し元（index.ts）が事前に解決した結果を渡す
 */
export async function loadAndResolveConfig(
  path: string,
  workspaceManager: WorkspaceManager,
  detectedShellProfiles: ShellProfile[] = [],
  sendNotification: (opts: NiwaNotifyOptions) => void = () => {},
  reloadConfig: () => Promise<void> = async () => {},
): Promise<{
  keybindings: KeybindingsConfig;
  appearance: ResolvedAppearanceConfig;
  browser: ResolvedBrowserConfig;
  customView: ResolvedCustomViewConfig | null;
  defaultShell: string | undefined;
  shellProfiles: ShellProfile[];
  layouts: LayoutsConfig;
  mouse: ResolvedMouseConfig;
  /** 選択範囲の右クリックメニュー（mouse.selectionMenu）の組み立てと実行 */
  selectionMenu: SelectionMenuHandle;
  workspaceDefaultCwd: string | undefined;
  /** キーバインドの関数ハンドラ（BindingTargetのkind:"custom"）を実行する。RPCのrunKeybindHandlerから呼ぶ */
  runKeybindHandler: (id: string) => Promise<void>;
  /** niwa.on("bell", ...)で登録されたハンドラ。未登録はnull（既定の処理を使う） */
  bellHandler: NiwaBellHandler | null;
  /** ベルの既定の処理（niwa.bell.defaultと同じもの）。ハンドラ未登録時の処理として呼ぶ */
  runDefaultBell: (event: NiwaBellEvent) => void;
}> {
  const userConfig = await loadUserConfig(path);
  const shellProfiles = resolveShellProfiles(userConfig, detectedShellProfiles);
  // niwa.tab.createのshellProfile解決に使うため、resolveKeybindingsより先にshellProfilesを確定させる
  const niwaApi = createNiwaApi({
    workspaceManager,
    getShellProfiles: () => shellProfiles,
    getShellRunEnv: () => ({
      NIWATERM_SOCKET: ipcSocketPath(),
      NIWATERM_BRIDGE_PORT: String(getWslBridgePort() ?? ""),
      NIWATERM_APP_VARIANT: APP_VARIANT,
    }),
    getDefaultShell: () => resolveShell(userConfig),
    sendNotification,
    reloadConfig,
  });
  // niwa.keybind/niwa.onの登録はどちらもconfigファイルの実行（resolveKeybindings内）で起きる。
  // 登録内容の取り出しはその後でなければならない
  const keybindings = resolveKeybindings(userConfig, niwaApi);
  return {
    keybindings,
    appearance: resolveAppearance(userConfig),
    browser: resolveBrowser(userConfig),
    customView: resolveCustomView(userConfig),
    defaultShell: resolveShell(userConfig),
    shellProfiles,
    layouts: resolveLayouts(userConfig),
    mouse: resolveMouse(userConfig),
    selectionMenu: createSelectionMenu(resolveSelectionMenu(userConfig), niwaApi.niwa),
    workspaceDefaultCwd: resolveWorkspaceDefaultCwd(userConfig),
    runKeybindHandler: niwaApi.runHandler,
    bellHandler: niwaApi.extractBellHandler(),
    runDefaultBell: niwaApi.runDefaultBell,
  };
}
