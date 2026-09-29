// ユーザー設定ファイル（~/.config/niwaterm/niwaterm.config.ts）の読み込み。
// ファイル不在・importエラー・スキーマ不一致いずれでも例外を投げない（persistence.tsのloadPersistedStateと同じ設計）。
// 不備は握り潰さずConfigDiagnosticsへ積み、ファイル自体を読めなかった場合はloadErrorで呼び出し元へ伝える。
// 設定の一部の誤りが他の項目まで巻き込まないよう、値はフィールド単位・エントリ単位で検証し、
// ユーザー関数（keybindingsのKeybindingsFn）の例外もセクション内で止める。

import { existsSync, rmSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type AppearanceConfig,
  defaultAppearance,
  defaultBoardConfig,
  defaultBrowserConfig,
  defaultLinkConfig,
  defaultMouseConfig,
  defaultTerminalConfig,
  defaultUiColors,
  type CustomViewConfig,
  type CustomViewHandlers,
  HOVER_BUTTON_POSITIONS,
  type HoverButtonConfig,
  type HoverButtonContext,
  type HoverButtonItemsFn,
  isHoverButtonPosition,
  isBoardNaming,
  isKeybindAction,
  isLinkModifier,
  type LinkRule,
  isLinkOpenTarget,
  isNewTabCwdMode,
  isTabBarMode,
  isTitleBarMode,
  type KeybindingsConfig,
  type LayoutPreset,
  type LayoutsConfig,
  type Niwa,
  type NiwaBellEvent,
  type NiwaBellHandler,
  type NiwaLinkEvent,
  type NiwaLinkHandler,
  type NiwaNotifyOptions,
  type NiwatermConfig,
  normalizeBoardPhases,
  normalizeSidebarBoardStatus,
  parseKeyBindingString,
  parseSecondKeyString,
  platformDefaultKeybindings,
  resolveBindingEntry,
  type ResolvedAppearanceConfig,
  type ResolvedBoardConfig,
  type ResolvedBrowserConfig,
  type ResolvedCustomViewConfig,
  DEFAULT_HOVER_BUTTON_POSITION,
  DEFAULT_HOVER_HANDLE_ICON,
  DEFAULT_HOVER_HANDLE_SHAPE,
  DEFAULT_HOVER_TRIGGER_PX,
  HOVER_BUTTON_HANDLE_SHAPES,
  HOVER_BUTTON_HANDLE_STYLES,
  HOVER_TRIGGER_MAX_PX,
  HOVER_TRIGGER_MIN_PX,
  type ResolvedHoverButtonConfig,
  type ResolvedHoverButtonHandle,
  type ResolvedLinkConfig,
  type ResolvedLinkRule,
  type ResolvedMouseConfig,
  type ResolvedSidebarConfig,
  DEFAULT_STATUS_BAR,
  parseStatusBarSource,
  STATUS_BAR_MIN_INTERVAL_MS,
  STATUS_BAR_SECTIONS,
  type StatusBarComponentConfig,
  toResolvedLinkRule,
  type ResolvedTerminalConfig,
  type ResolvedUiColors,
  type SelectionMenuFn,
  type ShellProfile,
  WORKSPACES_VIEW_ID,
} from "@niwaterm/config";
import { APP_VARIANT } from "./app-variant.generated";
import { resolveBackgroundImage } from "./background-image";
import {
  type ConfigDiagnostic,
  type ConfigDiagnostics,
  createConfigDiagnostics,
  describeValue,
} from "./config-diagnostics";
import {
  createCustomViewHandlers,
  type CustomViewHandlersById,
  type CustomViewHandlersHandle,
} from "./custom-view-handlers";
import {
  createHoverButtons,
  type HoverButtonGroup,
  type HoverButtonsHandle,
} from "./hover-buttons";
import { getWslBridgePort, ipcSocketPath } from "./ipc-server";
import { createNiwaApi, type NiwaApiHandle } from "./niwa-api";
import { createSelectionMenu, type SelectionMenuHandle } from "./selection-menu";
import type { StatusBarComponentEntry, StatusBarDefinition } from "./status-bar";
import type { WorkspaceManager } from "./workspace-manager";

/**
 * 設定ディレクトリ。NIWATERM_CONFIG_DIRが設定されていればそちらを使う（開発中ビルドへ普段遣いとは
 * 別の設定を読ませるための口）。相対パスはアプリのcwd基準になり予測しづらいため絶対パスで渡す。
 */
export function configDirPath(): string {
  const override = process.env["NIWATERM_CONFIG_DIR"];
  if (override) return resolve(override);
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
  if ("customViews" in v) {
    if (!Array.isArray(v["customViews"])) return false;
  }
  if ("hoverButtons" in v) {
    if (!Array.isArray(v["hoverButtons"])) return false;
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
  if ("terminal" in v) {
    const te = v["terminal"];
    if (typeof te !== "object" || te === null) return false;
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

export interface LoadUserConfigResult {
  /** 読み込めた設定。ファイル不在・読み込み失敗はnull */
  config: NiwatermConfig | null;
  /**
   * 読み込めなかった理由。ファイル不在と成功時はnull。
   * 「設定ファイルはあるのに読めていない」をファイル不在と区別するために分けている
   * （呼び出し元は前者でだけ直前の設定を残す）
   */
  error: string | null;
}

/** importFreshConfigが作る一時ディレクトリのパス。mkdtempがプレフィックスへ6文字を足す */
const TEMP_IMPORT_DIR_PATTERN = /[^\s"']*niwaterm-config-[A-Za-z0-9]{6}/gu;

/**
 * エラーメッセージに出る一時importディレクトリのパスを、元の設定ディレクトリへ戻す。
 * importFreshConfigがソースをコピーしてから読むため、そのまま見せるとユーザーが見たことのない
 * パスが出て、どのファイルを直せばよいのか分からなくなる
 */
export function restoreConfigDirInMessage(message: string, configDir: string): string {
  return message.replaceAll(TEMP_IMPORT_DIR_PATTERN, configDir);
}

/**
 * ファイル不在・importエラー・exportがNiwatermConfigの形をしていない、いずれでも例外を投げない。
 * 一時ディレクトリへソースをコピーしてからimportし、毎回ファイルツリーの最新内容を読み込む（ホットリロード対応）。
 */
export async function loadUserConfig(path: string): Promise<LoadUserConfigResult> {
  try {
    if (!(await Bun.file(path).exists())) return { config: null, error: null };
    const mod = await importFreshConfig(path);
    const candidate = (mod as { default?: unknown }).default ?? mod;
    if (!isNiwatermConfig(candidate)) {
      return { config: null, error: `NiwatermConfigの形のexportがありません: ${path}` };
    }
    return { config: candidate, error: null };
  } catch (err) {
    return { config: null, error: restoreConfigDirInMessage(String(err), dirname(path)) };
  }
}

export interface ConfigLoadOutcome {
  /** 解決結果を適用するか。falseなら直前に適用した設定をそのまま使い続ける */
  apply: boolean;
  /** 出すデスクトップ通知。不要ならnull */
  notification: NiwaNotifyOptions | null;
}

/**
 * 読み込み結果を適用するか・ユーザーへ知らせるかを決める。
 *
 * 読めなかったときは適用済みの設定を残す: 全項目を既定値へ落とすと、設定ファイル1箇所のtypoで
 * prefixもテーマもカスタムビューも同時に消え、編集を戻すための操作すら効かなくなる。
 * まだ一度も適用していない（起動直後）の場合だけは、残せる前の状態が無いので既定値を当てる。
 *
 * 通知はエラーの内容が変わったときだけ出す。ホットリロードはファイル保存のたびに走るので、
 * 直し途中の同じエラーで何度も鳴らさない。
 */
export function decideConfigLoadOutcome(args: {
  configFile: string;
  loadError: string | null;
  /** 直前の読み込み試行のエラー。初回・前回成功時はnull */
  previousError: string | null;
  /** 設定を一度でも適用したか */
  alreadyApplied: boolean;
}): ConfigLoadOutcome {
  const { configFile, loadError, previousError, alreadyApplied } = args;
  if (loadError === null) {
    return {
      apply: true,
      notification:
        previousError === null
          ? null
          : { title: "設定ファイルを読み込み直しました", body: configFile },
    };
  }
  const changed = loadError !== previousError;
  return {
    apply: !alreadyApplied,
    notification: changed
      ? {
          title: "設定ファイルを読み込めません",
          body: alreadyApplied ? `${loadError}\n直前に読み込めた設定のままにしています` : loadError,
        }
      : null,
  };
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
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): KeybindingsConfig {
  const platformDefault = platformDefaultKeybindings(process.platform);
  applyKeybindingsObject(niwaApi.niwa, platformDefault, "defaultKeybindings", diag);

  const user = userConfig?.keybindings;
  if (typeof user === "function") {
    // 途中で例外が出てもそこまでのniwa.keybind/prefix呼び出しは登録済みのまま残す。
    // ここで投げ直すと呼び出し元が設定ごと捨ててしまい、キーバインド以外の設定まで既定値へ落ちる
    try {
      user(niwaApi.niwa);
    } catch (err) {
      diag.error(
        "keybindings",
        `関数が途中で失敗しました（失敗より前の登録だけが有効です）: ${String(err)}`,
      );
    }
  } else if (user) {
    applyKeybindingsObject(niwaApi.niwa, user, "keybindings", diag);
  }

  return niwaApi.extractKeybindingsConfig();
}

/** KeybindingsConfig（prefix/bindings/direct/repeatTimeoutMs）の内容をniwa.keybind呼び出し列に変換して登録する */
function applyKeybindingsObject(
  niwa: Niwa,
  config: KeybindingsConfig,
  source: string,
  diag: ConfigDiagnostics,
): void {
  if (config.prefix !== undefined) {
    if (parseKeyBindingString(config.prefix)) {
      niwa.prefix(config.prefix);
    } else {
      diag.warn(
        `${source}.prefix`,
        `キー指定として解釈できないため既定値を使います: ${describeValue(config.prefix)}`,
      );
    }
  }
  if (config.repeatTimeoutMs !== undefined) {
    if (typeof config.repeatTimeoutMs === "number" && config.repeatTimeoutMs > 0) {
      niwa.repeatTimeout(config.repeatTimeoutMs);
    } else {
      diag.warn(
        `${source}.repeatTimeoutMs`,
        `正の数ではないため既定値を使います: ${describeValue(config.repeatTimeoutMs)}`,
      );
    }
  }
  for (const [key, rawEntry] of Object.entries(config.bindings ?? {})) {
    if (rawEntry === undefined) continue;
    const resolved = resolveBindingEntry(rawEntry);
    if (!parseSecondKeyString(key) || !resolved || !isKeybindAction(resolved.target)) {
      diag.warn(
        `${source}.bindings["${key}"]`,
        `キーかアクション名が不正なためこのエントリだけ無視します: ${describeValue(rawEntry)}`,
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
      diag.warn(
        `${source}.direct["${key}"]`,
        `キーかアクション名が不正なためこのエントリだけ無視します: ${describeValue(rawEntry)}`,
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
  diag: ConfigDiagnostics,
  section: string,
  fieldName: string,
  userValue: unknown,
  defaultValue: T,
  isValid: (v: unknown) => v is T,
): T {
  if (userValue === undefined) return defaultValue;
  if (isValid(userValue)) return userValue;
  diag.warn(
    `${section}.${fieldName}`,
    `値が不正なため既定値(${describeValue(defaultValue)})を使います: ${describeValue(userValue)}`,
  );
  return defaultValue;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOpacity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * defaultUiColorsにユーザー設定をマージした最終値を返す。全フィールドが同じ「CSSカラー値の
 * 文字列」なので、キーを並べて回すだけで済む
 */
function resolveUiColors(user: AppearanceConfig["ui"], diag: ConfigDiagnostics): ResolvedUiColors {
  const resolved = { ...defaultUiColors };
  for (const key of Object.keys(defaultUiColors) as (keyof ResolvedUiColors)[]) {
    resolved[key] = resolveField(
      diag,
      "appearance.ui",
      key,
      user?.[key],
      defaultUiColors[key],
      isNonEmptyString,
    );
  }
  return resolved;
}

/**
 * defaultAppearanceにユーザー設定をマージし、フィールド単位・ansiColorsはindex単位で
 * 不正値を警告付きで除外した最終値を返す（resolveKeybindingsと同じper-entry方針）。
 */
export function resolveAppearance(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): ResolvedAppearanceConfig {
  const user = userConfig?.appearance;

  const ansiColors = [...defaultAppearance.ansiColors];
  if (user?.ansiColors !== undefined) {
    for (let i = 0; i < ansiColors.length; i++) {
      const color = user.ansiColors[i];
      if (color === undefined) continue;
      if (isNonEmptyString(color)) {
        ansiColors[i] = color;
      } else {
        diag.warn(
          `appearance.ansiColors[${i}]`,
          `色として使えないためこの1色だけ既定値を使います: ${describeValue(color)}`,
        );
      }
    }
  }

  return {
    fontFamily: resolveField(
      diag,
      "appearance",
      "fontFamily",
      user?.fontFamily,
      defaultAppearance.fontFamily,
      isNonEmptyString,
    ),
    fontSize: resolveField(
      diag,
      "appearance",
      "fontSize",
      user?.fontSize,
      defaultAppearance.fontSize,
      isPositiveNumber,
    ),
    lineHeight: resolveField(
      diag,
      "appearance",
      "lineHeight",
      user?.lineHeight,
      defaultAppearance.lineHeight,
      isPositiveNumber,
    ),
    foreground: resolveField(
      diag,
      "appearance",
      "foreground",
      user?.foreground,
      defaultAppearance.foreground,
      isNonEmptyString,
    ),
    background: resolveField(
      diag,
      "appearance",
      "background",
      user?.background,
      defaultAppearance.background,
      isNonEmptyString,
    ),
    backgroundOpacity: resolveField(
      diag,
      "appearance",
      "backgroundOpacity",
      user?.backgroundOpacity,
      defaultAppearance.backgroundOpacity,
      isOpacity,
    ),
    backgroundImage: resolveBackgroundImage(
      resolveField(
        diag,
        "appearance",
        "backgroundImage",
        user?.backgroundImage,
        defaultAppearance.backgroundImage,
        isNonEmptyString,
      ),
    ),
    ansiColors,
    tabBar: resolveField(
      diag,
      "appearance",
      "tabBar",
      user?.tabBar,
      defaultAppearance.tabBar,
      isTabBarMode,
    ),
    titleBar: resolveField(
      diag,
      "appearance",
      "titleBar",
      user?.titleBar,
      defaultAppearance.titleBar,
      isTitleBarMode,
    ),
    tileBorderRadius: resolveField(
      diag,
      "appearance",
      "tileBorderRadius",
      user?.tileBorderRadius,
      defaultAppearance.tileBorderRadius,
      isNonNegativeNumber,
    ),
    tileGap: resolveField(
      diag,
      "appearance",
      "tileGap",
      user?.tileGap,
      defaultAppearance.tileGap,
      isNonNegativeNumber,
    ),
    inactiveTileDim: resolveField(
      diag,
      "appearance",
      "inactiveTileDim",
      user?.inactiveTileDim,
      defaultAppearance.inactiveTileDim,
      isOpacity,
    ),
    tileShadow: resolveField(
      diag,
      "appearance",
      "tileShadow",
      user?.tileShadow,
      defaultAppearance.tileShadow,
      isNonEmptyString,
    ),
    ui: resolveUiColors(user?.ui, diag),
  };
}

/**
 * defaultBrowserConfigにユーザー設定をマージした最終値を返す（resolveAppearanceと同じper-field方針）。
 */
export function resolveBrowser(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): ResolvedBrowserConfig {
  const user = userConfig?.browser;
  return {
    defaultUrl: resolveField(
      diag,
      "browser",
      "defaultUrl",
      user?.defaultUrl,
      defaultBrowserConfig.defaultUrl,
      isNonEmptyString,
    ),
  };
}

/**
 * defaultBoardConfigにユーザー設定をマージした最終値を返す（resolveAppearanceと同じper-field方針）。
 */
export function resolveBoard(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): ResolvedBoardConfig {
  const user = userConfig?.board;
  return {
    newTabCwd: resolveField(
      diag,
      "board",
      "newTabCwd",
      user?.newTabCwd,
      defaultBoardConfig.newTabCwd,
      isNewTabCwdMode,
    ),
    naming: resolveField(
      diag,
      "board",
      "naming",
      user?.naming,
      defaultBoardConfig.naming,
      isBoardNaming,
    ),
    // 要素単位で落とす正規化なのでresolveFieldは通さない（不正な1件だけを捨てる）
    phases: normalizeBoardPhases(user?.phases),
  };
}

/**
 * サイドバーのBoard行に出すステータスライン項目を解決する。
 */
export function resolveSidebar(userConfig: NiwatermConfig | null): ResolvedSidebarConfig {
  return {
    // 要素単位で落とす正規化なのでresolveFieldは通さない（board.phasesと同じ）
    boardStatus: normalizeSidebarBoardStatus(userConfig?.sidebar?.boardStatus),
  };
}

/**
 * defaultTerminalConfigにユーザー設定をマージした最終値を返す（resolveAppearanceと同じper-field方針）。
 */
export function resolveTerminal(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): ResolvedTerminalConfig {
  const user = userConfig?.terminal;
  return {
    scrollback: resolveField(
      diag,
      "terminal",
      "scrollback",
      user?.scrollback,
      defaultTerminalConfig.scrollback,
      isNonNegativeInteger,
    ),
  };
}

/**
 * link設定を解決する。rulesはユーザーが1件でも指定したら既定のルールを置き換える
 * （既定のルールへ追記する形にすると「既定を外したい」が表現できないため）。
 * 正規表現はwebviewへRPCで渡すためsource/flagsへ分解し、ここでコンパイルできるかまで見ておく
 * （不正なパターンを送りつけても向こうで捨てられるだけで、警告を出す場所がなくなる）
 */
export function resolveLink(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
  platform: string = process.platform,
): ResolvedLinkConfig {
  const user = userConfig?.link;
  const defaults = defaultLinkConfig(platform);
  return {
    rules: resolveLinkRules(user?.rules, resolvedDefaultLinkRules(defaults.rules), diag),
    modifier: resolveField(
      diag,
      "link",
      "modifier",
      user?.modifier,
      defaults.modifier,
      isLinkModifier,
    ),
    open: resolveField(diag, "link", "open", user?.open, defaults.open, isLinkOpenTarget),
  };
}

function resolveLinkRules(
  rules: unknown,
  defaults: ResolvedLinkRule[],
  diag: ConfigDiagnostics,
): ResolvedLinkRule[] {
  if (rules === undefined) return defaults;
  if (!Array.isArray(rules)) {
    diag.warn("link.rules", `配列ではないため既定のルールを使います: ${describeValue(rules)}`);
    return defaults;
  }
  // 空配列は「素のURLの検出をやめる」という明示的な指定として通す（OSC 8のリンクだけが残る）
  if (rules.length === 0) return [];
  const resolved: ResolvedLinkRule[] = [];
  for (const [index, rule] of rules.entries()) {
    const normalized = normalizeLinkRule(rule, `link.rules[${index}]`, diag);
    if (normalized) resolved.push(normalized);
  }
  // 書いたルールが全滅した場合だけ既定へ戻す（1件でも生きていれば意図した置き換えとして扱う）
  return resolved.length > 0 ? resolved : defaults;
}

function normalizeLinkRule(
  rule: unknown,
  field: string,
  diag: ConfigDiagnostics,
): ResolvedLinkRule | null {
  if (!isPlainObject(rule)) {
    diag.warn(field, `オブジェクトではないため無視します: ${describeValue(rule)}`);
    return null;
  }
  const { regex, format } = rule as { regex?: unknown; format?: unknown };
  const resolved = toResolvedLinkRule({ regex } as LinkRule);
  if (!resolved) {
    diag.warn(field, `regexが正規表現として解釈できないため無視します: ${describeValue(regex)}`);
    return null;
  }
  if (format !== undefined && typeof format !== "string") {
    diag.warn(
      field,
      `formatが文字列ではないため$0（マッチ全体）を使います: ${describeValue(format)}`,
    );
  }
  return { ...resolved, format: typeof format === "string" ? format : "$0" };
}

/** 既定のルールを解決済みの形へ直す。既定値は必ず妥当なので落ちる要素は無い */
function resolvedDefaultLinkRules(defaults: LinkRule[]): ResolvedLinkRule[] {
  return defaults.map(toResolvedLinkRule).filter((rule) => rule !== null);
}

/**
 * defaultMouseConfigにユーザー設定をマージした最終値を返す（resolveAppearanceと同じper-field方針）。
 */
export function resolveMouse(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): ResolvedMouseConfig {
  const user = userConfig?.mouse;
  return {
    copyOnSelect: resolveField(
      diag,
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
export function resolveSelectionMenu(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): SelectionMenuFn | null {
  const fn = userConfig?.mouse?.selectionMenu;
  if (fn === undefined) return null;
  if (typeof fn !== "function") {
    diag.warn(
      "mouse.selectionMenu",
      `関数ではないため右クリックメニューは組み込み項目だけになります: ${describeValue(fn)}`,
    );
    return null;
  }
  return fn;
}

/** customViewのhandlersのうち関数の項目だけを残す。不正な項目の警告はresolveCustomViewsが出す */
function validCustomViewHandlers(handlers: CustomViewHandlers | undefined): CustomViewHandlers {
  if (typeof handlers !== "object" || handlers === null) return {};
  return Object.fromEntries(
    Object.entries(handlers).filter(([, handler]) => typeof handler === "function"),
  );
}

/** id未指定のcustomViewに充てるidの素。英数字以外は区切りへ潰し、前後の区切りは落とす */
function slugifyViewId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/** 既に使われているidなら連番のサフィックスを足して一意にする */
function uniqueViewId(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

/**
 * pathがあればconfigDirPath()基準でfile://に解決し、無ければurlをそのまま使う。どちらも無効ならnull。
 * 指したファイルが無くてもビューは残す（存在するかどうかでid採番が変わると、HTMLを置いた途端に
 * キーバインド・CLIから指すidがずれる）。代わりに警告を出して空白のビューの理由が分かるようにする
 */
function resolveCustomViewUrl(
  user: CustomViewConfig,
  scope: string,
  diag: ConfigDiagnostics,
): string | null {
  if (isNonEmptyString(user.path)) {
    const filePath = resolve(configDirPath(), user.path);
    if (!existsSync(filePath)) {
      diag.warn(`${scope}.path`, `ファイルが見つかりません（ビューは空白になります）: ${filePath}`);
    }
    return pathToFileURL(filePath).href;
  }
  if (isNonEmptyString(user.url)) return user.url;
  return null;
}

export interface ResolvedCustomViews {
  /** 設定に並べた順のビュー一覧。1つも無ければ空配列（＝機能オフ） */
  views: ResolvedCustomViewConfig[];
  /**
   * ビューid → handlersの実体。関数はRPCで渡せないためResolvedCustomViewConfigには含めず、
   * bun側に残したままcreateCustomViewHandlersへ渡す（mouse.selectionMenuと同じ分け方）
   */
  handlersById: CustomViewHandlersById;
}

/**
 * ユーザー定義HTML UI設定を解決する。path・urlのどちらも無い要素は警告して飛ばす。
 * idは明示指定 > nameから導いたslug > 連番の順で決め、重複はサフィックスで一意にする
 * （idはキーバインド・CLIからビューを指す唯一の手がかりなので、重複したまま残すと
 * どちらが出るか決まらなくなる）。ワークスペース一覧のidは予約語として先に押さえておく。
 * nameは省略時、サイドバーのラベルが同じにならないよう連番付きへフォールバックする
 */
export function resolveCustomViews(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): ResolvedCustomViews {
  const list = userConfig?.customViews;
  if (!Array.isArray(list)) return { views: [], handlersById: {} };

  const views: ResolvedCustomViewConfig[] = [];
  const handlersById: CustomViewHandlersById = {};
  const usedIds = new Set<string>([WORKSPACES_VIEW_ID]);
  for (const [index, user] of list.entries()) {
    const scope = `customViews[${index}]`;
    if (typeof user !== "object" || user === null) {
      diag.warn(scope, `オブジェクトではないためこの要素だけ無視します: ${describeValue(user)}`);
      continue;
    }
    const url = resolveCustomViewUrl(user, scope, diag);
    if (url === null) {
      diag.warn(scope, "pathかurlのどちらかが必要なためこの要素だけ無視します");
      continue;
    }
    const name = isNonEmptyString(user.name) ? user.name : `Custom View ${index + 1}`;
    const handlers = validCustomViewHandlers(user.handlers);
    for (const key of Object.keys(user.handlers ?? {})) {
      if (!(key in handlers)) {
        diag.warn(`${scope}.handlers.${key}`, "関数ではないためこのハンドラだけ無視します");
      }
    }
    const preferredId = isNonEmptyString(user.id) ? slugifyViewId(user.id) : slugifyViewId(name);
    const id = uniqueViewId(preferredId === "" ? `custom-view-${index + 1}` : preferredId, usedIds);
    usedIds.add(id);
    views.push({ id, name, url, handlerNames: Object.keys(handlers) });
    handlersById[id] = handlers;
  }
  return { views, handlersById };
}

/** position不正の警告に並べる候補。HOVER_BUTTON_POSITIONSをそのまま文字列化したもの */
const HOVER_BUTTON_POSITION_HINT = HOVER_BUTTON_POSITIONS.join(" / ");

/**
 * 取っ手を解決する。不正なフィールドは警告してそのフィールドだけ既定値へ落とす
 * （取っ手ごと消すと、ボタンに辿り着く手段が画面から無くなるため）
 */
function resolveHoverHandle(
  value: unknown,
  scope: string,
  diag: ConfigDiagnostics,
): ResolvedHoverButtonHandle | null {
  if (value === false) return null;
  const handle: ResolvedHoverButtonHandle = {
    style: "edge",
    shape: DEFAULT_HOVER_HANDLE_SHAPE,
    icon: DEFAULT_HOVER_HANDLE_ICON,
  };
  if (value === undefined) return handle;
  if (typeof value !== "object" || value === null) {
    diag.warn(
      scope,
      `falseかオブジェクトでないため既定の取っ手を使います: ${describeValue(value)}`,
    );
    return handle;
  }
  const user = value as Record<string, unknown>;
  const style = user["style"];
  if (style !== undefined) {
    if ((HOVER_BUTTON_HANDLE_STYLES as readonly unknown[]).includes(style)) {
      handle.style = style as ResolvedHoverButtonHandle["style"];
    } else {
      diag.warn(
        `${scope}.style`,
        `${HOVER_BUTTON_HANDLE_STYLES.join(" / ")}のいずれかでないため"edge"を使います: ${describeValue(style)}`,
      );
    }
  }
  const shape = user["shape"];
  if (shape !== undefined) {
    if ((HOVER_BUTTON_HANDLE_SHAPES as readonly unknown[]).includes(shape)) {
      handle.shape = shape as ResolvedHoverButtonHandle["shape"];
    } else {
      diag.warn(
        `${scope}.shape`,
        `${HOVER_BUTTON_HANDLE_SHAPES.join(" / ")}のいずれかでないため"${DEFAULT_HOVER_HANDLE_SHAPE}"を使います: ${describeValue(shape)}`,
      );
    }
  }
  const icon = user["icon"];
  if (icon !== undefined) {
    if (isNonEmptyString(icon)) handle.icon = icon;
    else
      diag.warn(
        `${scope}.icon`,
        `空でない文字列ではないため既定の印を使います: ${describeValue(icon)}`,
      );
  }
  return handle;
}

/** 呼び出しの帯の太さ。数値でなければ既定値、範囲外なら丸めて、どちらも警告する */
function resolveHoverTrigger(value: unknown, scope: string, diag: ConfigDiagnostics): number {
  if (value === undefined) return DEFAULT_HOVER_TRIGGER_PX;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diag.warn(
      scope,
      `数値ではないため${DEFAULT_HOVER_TRIGGER_PX}pxを使います: ${describeValue(value)}`,
    );
    return DEFAULT_HOVER_TRIGGER_PX;
  }
  const clamped = Math.round(Math.min(HOVER_TRIGGER_MAX_PX, Math.max(HOVER_TRIGGER_MIN_PX, value)));
  if (clamped !== value) {
    diag.warn(
      scope,
      `${HOVER_TRIGGER_MIN_PX}〜${HOVER_TRIGGER_MAX_PX}の整数へ丸めます: ${describeValue(value)} -> ${clamped}`,
    );
  }
  return clamped;
}

/**
 * ホバーボタンを解決する。position不正・itemsが関数でない要素は警告して飛ばす。
 * idは明示指定 > positionからの連番の順で決め、重複はサフィックスで一意にする
 * （idはCLIからボタンを指す唯一の手がかりなので、重複したまま残すとどちらを指すか決まらなくなる）。
 * showが関数でない場合はその要素だけ「常に出す」へ落とす（ボタン自体は残す。
 * 条件の書き損じでボタンが消えると、設定のどこが悪いのか画面から分からなくなるため）
 */
export function resolveHoverButtons(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): HoverButtonGroup[] {
  const list = userConfig?.hoverButtons;
  if (!Array.isArray(list)) return [];

  const groups: HoverButtonGroup[] = [];
  const usedIds = new Set<string>();
  for (const [index, user] of list.entries()) {
    const scope = `hoverButtons[${index}]`;
    if (typeof user !== "object" || user === null) {
      diag.warn(scope, `オブジェクトではないためこの要素だけ無視します: ${describeValue(user)}`);
      continue;
    }
    const entry = user as HoverButtonConfig;
    const position = entry.position ?? DEFAULT_HOVER_BUTTON_POSITION;
    if (!isHoverButtonPosition(position)) {
      diag.warn(
        `${scope}.position`,
        `${HOVER_BUTTON_POSITION_HINT}のいずれかでないためこの要素だけ無視します: ${describeValue(position)}`,
      );
      continue;
    }
    if (typeof entry.items !== "function") {
      diag.warn(
        `${scope}.items`,
        `関数ではないためこの要素だけ無視します: ${describeValue(entry.items)}`,
      );
      continue;
    }
    let show: ((ctx: HoverButtonContext) => boolean) | undefined;
    if (entry.show !== undefined) {
      if (typeof entry.show === "function") show = entry.show;
      else {
        diag.warn(
          `${scope}.show`,
          `関数ではないため全てのターミナルタブへ出します: ${describeValue(entry.show)}`,
        );
      }
    }
    const preferredId = isNonEmptyString(entry.id) ? slugifyViewId(entry.id) : "";
    const id = uniqueViewId(preferredId === "" ? position : preferredId, usedIds);
    usedIds.add(id);
    groups.push({
      id,
      position,
      css: isNonEmptyString(entry.css) ? entry.css : "",
      handle: resolveHoverHandle(entry.handle, `${scope}.handle`, diag),
      trigger: resolveHoverTrigger(entry.trigger, `${scope}.trigger`, diag),
      show,
      items: entry.items as HoverButtonItemsFn,
    });
  }
  return groups;
}

/** 文字列フィールド。未指定は空文字列、文字列でなければ警告して空文字列へ落とす */
function resolveOptionalString(value: unknown, scope: string, diag: ConfigDiagnostics): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  diag.warn(scope, `文字列ではないため無視します: ${describeValue(value)}`);
  return "";
}

/** renderを呼び直す周期。数値でなければ警告して周期無し、下限未満は切り上げて警告する */
function resolveStatusBarInterval(
  value: unknown,
  scope: string,
  diag: ConfigDiagnostics,
): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    diag.warn(scope, `正の数値ではないため状況が変わった時だけ呼びます: ${describeValue(value)}`);
    return null;
  }
  const interval = Math.max(STATUS_BAR_MIN_INTERVAL_MS, Math.round(value));
  if (interval !== value) {
    diag.warn(
      scope,
      `${STATUS_BAR_MIN_INTERVAL_MS}ms以上の整数へ丸めます: ${value} -> ${interval}`,
    );
  }
  return interval;
}

function resolveStatusBarComponent(
  raw: unknown,
  id: string,
  section: StatusBarComponentEntry["section"],
  scope: string,
  diag: ConfigDiagnostics,
): StatusBarComponentEntry | null {
  const entry: StatusBarComponentEntry = {
    id,
    section,
    source: null,
    render: undefined,
    interval: null,
    prefix: "",
    color: "",
    tooltip: "",
    run: undefined,
  };
  const user: StatusBarComponentConfig | null =
    typeof raw === "string"
      ? { source: raw }
      : typeof raw === "object" && raw !== null
        ? (raw as StatusBarComponentConfig)
        : null;
  if (user === null) {
    diag.warn(scope, `文字列かオブジェクトでないためこの部品だけ無視します: ${describeValue(raw)}`);
    return null;
  }
  if (user.render !== undefined) {
    if (typeof user.render !== "function") {
      diag.warn(
        `${scope}.render`,
        `関数ではないためこの部品だけ無視します: ${describeValue(user.render)}`,
      );
      return null;
    }
    entry.render = user.render;
    entry.interval = resolveStatusBarInterval(user.interval, `${scope}.interval`, diag);
  } else {
    const source = typeof user.source === "string" ? parseStatusBarSource(user.source) : null;
    if (source === null) {
      diag.warn(
        `${scope}.source`,
        `builtin:mode / builtin:cwd / builtin:workspace / builtin:board / tab-var:<name>のいずれでもないためこの部品だけ無視します: ${describeValue(user.source)}`,
      );
      return null;
    }
    entry.source = source;
    if (user.interval !== undefined) {
      diag.warn(`${scope}.interval`, "renderを持たない部品では使わないため無視します");
    }
  }
  entry.prefix = resolveOptionalString(user.prefix, `${scope}.prefix`, diag);
  entry.color = resolveOptionalString(user.color, `${scope}.color`, diag);
  entry.tooltip = resolveOptionalString(user.tooltip, `${scope}.tooltip`, diag);
  if (user.run !== undefined) {
    if (typeof user.run === "function") entry.run = user.run;
    else
      diag.warn(`${scope}.run`, `関数ではないため押しても何もしません: ${describeValue(user.run)}`);
  }
  return entry;
}

/**
 * ステータスバーを解決する。falseなら出さない。区画ごとに、未指定なら既定の並び、
 * 配列でなければ警告して既定の並びへ落とす。不正な部品は警告してその部品だけ飛ばす
 * （1件の書き間違いでバーごと消えると、設定のどこが悪いのか画面から分からなくなるため）。
 * 全区画が空になった場合はバー自体を出さない（空の帯が1行ぶん場所を取るだけになるため）
 */
export function resolveStatusBar(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): StatusBarDefinition {
  const user = userConfig?.statusBar;
  if (user === false) return { visible: false, css: "", components: [] };
  let fields: Record<string, unknown> = {};
  if (user !== undefined) {
    if (typeof user === "object" && user !== null) fields = user as Record<string, unknown>;
    else
      diag.warn(
        "statusBar",
        `falseかオブジェクトでないため既定の並びを使います: ${describeValue(user)}`,
      );
  }
  const components: StatusBarComponentEntry[] = [];
  for (const section of STATUS_BAR_SECTIONS) {
    let list: unknown = fields[section];
    if (list === undefined) list = DEFAULT_STATUS_BAR[section];
    else if (!Array.isArray(list)) {
      diag.warn(
        `statusBar.${section}`,
        `配列ではないため既定の並びを使います: ${describeValue(list)}`,
      );
      list = DEFAULT_STATUS_BAR[section];
    }
    for (const [index, raw] of (list as unknown[]).entries()) {
      const entry = resolveStatusBarComponent(
        raw,
        `${section}-${index}`,
        section,
        `statusBar.${section}[${index}]`,
        diag,
      );
      if (entry) components.push(entry);
    }
  }
  return {
    visible: components.length > 0,
    css: resolveOptionalString(fields["css"], "statusBar.css", diag),
    components,
  };
}

/**
 * 新規タブ作成時に使うデフォルトシェルを解決する。未指定・不正値はundefined
 * （pty.ts側のOS標準シェルにフォールバックする。appearance/browserと異なりOS共通の
 * 既定値を持たないため、defaultAppearanceのような具体的なデフォルト定数は無い）。
 */
export function resolveShell(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): string | undefined {
  const user = userConfig?.shell?.default;
  if (user === undefined) return undefined;
  if (isNonEmptyString(user)) return user;
  diag.warn("shell.default", `文字列ではないためOS標準のシェルを使います: ${describeValue(user)}`);
  return undefined;
}

/**
 * 新規ワークスペース作成時に使うデフォルトcwdを解決する。未指定・不正値はundefined
 * （pty.ts側のOS標準ホームディレクトリにフォールバックする。resolveShellと同じ方針で
 * 具体的なデフォルト定数は持たない）。
 */
export function resolveWorkspaceDefaultCwd(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): string | undefined {
  const user = userConfig?.workspace?.defaultCwd;
  if (user === undefined) return undefined;
  if (isNonEmptyString(user)) return user;
  diag.warn(
    "workspace.defaultCwd",
    `文字列ではないためOS標準のホームディレクトリを使います: ${describeValue(user)}`,
  );
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
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): ShellProfile[] {
  const byId = new Map<string, ShellProfile>();
  for (const profile of detected) {
    byId.set(profile.id, profile);
  }
  const userProfiles = userConfig?.shell?.profiles;
  if (userProfiles !== undefined) {
    if (Array.isArray(userProfiles)) {
      for (const [index, profile] of userProfiles.entries()) {
        if (isValidShellProfile(profile)) {
          byId.set(profile.id, profile);
        } else {
          diag.warn(
            `shell.profiles[${index}]`,
            `id/name/commandが揃っていないためこの1件だけ無視します: ${describeValue(profile)}`,
          );
        }
      }
    } else {
      diag.warn(
        "shell.profiles",
        `配列ではないため自動検出ぶんだけを使います: ${describeValue(userProfiles)}`,
      );
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
export function resolveLayouts(
  userConfig: NiwatermConfig | null,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): LayoutsConfig {
  return normalizeLayouts(userConfig?.layouts, "layouts", diag);
}

/**
 * resolveLayoutsの実体。プロジェクトローカル設定（project-config.ts）からも
 * 同じ検証を使えるよう、NiwatermConfigではなくlayoutsの生値を受け取る形で切り出している。
 * sourceは警告ログに出す出所（"layouts" / "<projectRoot>/.niwaterm/config.ts layouts"）
 */
export function normalizeLayouts(
  user: unknown,
  source: string,
  diag: ConfigDiagnostics = createConfigDiagnostics(),
): LayoutsConfig {
  if (user === undefined) return {};
  if (!isPlainObject(user)) {
    diag.warn(
      source,
      `オブジェクトではないためプリセット無しとして扱います: ${describeValue(user)}`,
    );
    return {};
  }
  const result: LayoutsConfig = {};
  for (const [name, preset] of Object.entries(user)) {
    if (!isPlainObject(preset) || !isPlainObject(preset["layout"])) {
      diag.warn(`${source}.${name}`, "layoutフィールドが無いためこのプリセットだけ無視します");
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
  openLinkExternal: (url: string) => void = () => {},
): Promise<{
  /** 設定ファイルを読み込めたか。falseならファイル不在か読み込み失敗で、全項目が既定値 */
  userConfigLoaded: boolean;
  /**
   * 設定ファイルはあるのに読めなかった理由。ファイル不在・成功時はnull。
   * nullでないときこの戻り値は全項目が既定値なので、呼び出し元は直前の解決結果を残す判断に使う
   */
  loadError: string | null;
  /** 既定値へ落とした項目・無視した項目。`niwaterm config show`・設定モーダルに出す */
  diagnostics: ConfigDiagnostic[];
  keybindings: KeybindingsConfig;
  appearance: ResolvedAppearanceConfig;
  browser: ResolvedBrowserConfig;
  board: ResolvedBoardConfig;
  /** サイドバーのBoard行に出すステータスラインの構成 */
  sidebar: ResolvedSidebarConfig;
  terminal: ResolvedTerminalConfig;
  link: ResolvedLinkConfig;
  /** ユーザー定義HTML UI（サイドバーのビュー・タブ）の一覧。設定に並べた順 */
  customViews: ResolvedCustomViewConfig[];
  /** customViewのhandlersの実行（HTML側のniwaterm.callの実体） */
  customViewHandlers: CustomViewHandlersHandle;
  /** タブの端に出るホバーボタンの定義（関数を除いたもの）。設定に並べた順 */
  hoverButtons: ResolvedHoverButtonConfig[];
  /** ホバーボタンの帯を張る判定と、項目の組み立て・実行 */
  hoverButtonsHandle: HoverButtonsHandle;
  /**
   * ステータスバーの部品。intervalのタイマーを持つハンドルは、この解決結果を適用すると
   * 決めてから呼び出し元がniwaと合わせて作る（捨てる解決結果からタイマーが漏れないように）
   */
  statusBar: StatusBarDefinition;
  /** render・runへ渡すniwa API */
  niwa: Niwa;
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
  /** niwa.on("open-link", ...)で登録されたハンドラ。未登録はnull（既定の処理を使う） */
  linkHandler: NiwaLinkHandler | null;
  /** リンクの既定の処理（niwa.link.defaultと同じもの）。ハンドラ未登録時の処理として呼ぶ */
  runDefaultOpenLink: (event: NiwaLinkEvent) => void;
}> {
  const diag = createConfigDiagnostics();
  const { config: userConfig, error: loadError } = await loadUserConfig(path);
  // 読み込み失敗はloadErrorとして別に返すため、diagnosticsへは積まない（表示が二重になる）
  if (loadError !== null) {
    console.log(`[bun] failed to load config file: ${loadError}`);
  }
  const shellProfiles = resolveShellProfiles(userConfig, detectedShellProfiles, diag);
  // niwa.tab.createが引くため、niwaApiを作る前に確定させる。遅延評価にすると
  // タブを作るたびに解決し直すことになり、不正値の警告も毎回出てしまう
  const defaultShell = resolveShell(userConfig, diag);
  // niwa.link.defaultが開き先の判断に使うため、niwaApiを作る前に確定させる
  const link = resolveLink(userConfig, diag);
  // niwa.tab.createのshellProfile解決に使うため、resolveKeybindingsより先にshellProfilesを確定させる
  const niwaApi = createNiwaApi({
    workspaceManager,
    getShellProfiles: () => shellProfiles,
    getShellRunEnv: () => ({
      NIWATERM_SOCKET: ipcSocketPath(),
      NIWATERM_BRIDGE_PORT: String(getWslBridgePort() ?? ""),
      NIWATERM_APP_VARIANT: APP_VARIANT,
    }),
    getDefaultShell: () => defaultShell,
    sendNotification,
    reloadConfig,
    openLinkExternal,
    getLinkOpen: () => link.open,
  });
  // niwa.keybind/niwa.onの登録はどちらもconfigファイルの実行（resolveKeybindings内）で起きる。
  // 登録内容の取り出しはその後でなければならない
  const keybindings = resolveKeybindings(userConfig, niwaApi, diag);
  const customViews = resolveCustomViews(userConfig, diag);
  const hoverButtonsHandle = createHoverButtons(
    resolveHoverButtons(userConfig, diag),
    niwaApi.niwa,
  );
  return {
    userConfigLoaded: userConfig !== null,
    loadError,
    keybindings,
    appearance: resolveAppearance(userConfig, diag),
    browser: resolveBrowser(userConfig, diag),
    board: resolveBoard(userConfig, diag),
    sidebar: resolveSidebar(userConfig),
    terminal: resolveTerminal(userConfig, diag),
    link,
    customViews: customViews.views,
    customViewHandlers: createCustomViewHandlers(customViews.handlersById, niwaApi.niwa),
    hoverButtons: hoverButtonsHandle.resolved(),
    hoverButtonsHandle,
    statusBar: resolveStatusBar(userConfig, diag),
    niwa: niwaApi.niwa,
    defaultShell,
    shellProfiles,
    layouts: resolveLayouts(userConfig, diag),
    mouse: resolveMouse(userConfig, diag),
    selectionMenu: createSelectionMenu(resolveSelectionMenu(userConfig, diag), niwaApi.niwa),
    workspaceDefaultCwd: resolveWorkspaceDefaultCwd(userConfig, diag),
    runKeybindHandler: niwaApi.runHandler,
    bellHandler: niwaApi.extractBellHandler(),
    runDefaultBell: niwaApi.runDefaultBell,
    linkHandler: niwaApi.extractLinkHandler(),
    runDefaultOpenLink: niwaApi.runDefaultOpenLink,
    // 収集はここまでの全resolveXが終わってから。listは呼んだ時点のスナップショットを返す
    diagnostics: diag.list(),
  };
}
