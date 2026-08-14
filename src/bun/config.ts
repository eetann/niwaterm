// ユーザー設定ファイル（~/.config/niwaterm/niwaterm.config.ts）の読み込み。
// ファイル不在・importエラー・スキーマ不一致いずれでも例外を投げずnullを返す（persistence.tsのloadPersistedStateと同じ設計）。

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultAppearance,
  defaultBrowserConfig,
  isKeybindAction,
  type KeyBindingString,
  type KeybindingsConfig,
  type LayoutPreset,
  type LayoutsConfig,
  type NiwatermConfig,
  parseKeyBindingString,
  platformDefaultKeybindings,
  type ResolvedAppearanceConfig,
  type ResolvedBrowserConfig,
  type ResolvedCustomViewConfig,
  type ShellProfile,
} from "@niwaterm/config";

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
    if (typeof kb !== "object" || kb === null) return false;
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
  if ("workspace" in v) {
    const ws = v["workspace"];
    if (typeof ws !== "object" || ws === null) return false;
  }
  return true;
}

// import()のモジュールキャッシュを毎回確実にずらすための単調増加カウンタ。
// Date.now()だとミリ秒未満の間隔で連続読み込みした場合にクエリが衝突しうるため使わない。
let importCacheBustCounter = 0;

/**
 * ファイル不在・importエラー・exportがNiwatermConfigの形をしていない、いずれでも例外を投げずnullを返す。
 * クエリ文字列でキャッシュキーをずらし、毎回ファイルの最新内容を読み込む（ホットリロード対応）。
 */
export async function loadUserConfig(path: string): Promise<NiwatermConfig | null> {
  try {
    if (!(await Bun.file(path).exists())) return null;
    const mod: unknown = await import(`${path}?t=${importCacheBustCounter++}`);
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
 * プラットフォームのデフォルトキーバインドにユーザー設定をマージし、
 * 不正エントリを警告付きで除外した最終テーブルを返す。
 * 1箇所のtypoで全キーバインドがデフォルトに落ちるのを防ぐため、エントリ単位で検証する。
 */
export function resolveKeybindings(userConfig: NiwatermConfig | null): KeybindingsConfig {
  const merged: Record<string, unknown> = {
    ...platformDefaultKeybindings(process.platform),
    ...userConfig?.keybindings,
  };
  const result: KeybindingsConfig = {};
  for (const [binding, action] of Object.entries(merged)) {
    if (!parseKeyBindingString(binding) || !isKeybindAction(action)) {
      console.log(`[bun] ignoring invalid keybinding: "${binding}" -> ${String(action)}`);
      continue;
    }
    result[binding as KeyBindingString] = action;
  }
  return result;
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
    ansiColors,
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
  const user = userConfig?.layouts;
  if (user === undefined) return {};
  if (!isPlainObject(user)) {
    console.log(`[bun] ignoring invalid layouts: ${String(user)}`);
    return {};
  }
  const result: LayoutsConfig = {};
  for (const [name, preset] of Object.entries(user)) {
    if (!isPlainObject(preset) || !isPlainObject(preset["layout"])) {
      console.log(`[bun] ignoring invalid layouts entry: ${name}`);
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
  detectedShellProfiles: ShellProfile[] = [],
): Promise<{
  keybindings: KeybindingsConfig;
  appearance: ResolvedAppearanceConfig;
  browser: ResolvedBrowserConfig;
  customView: ResolvedCustomViewConfig | null;
  defaultShell: string | undefined;
  shellProfiles: ShellProfile[];
  layouts: LayoutsConfig;
  workspaceDefaultCwd: string | undefined;
}> {
  const userConfig = await loadUserConfig(path);
  return {
    keybindings: resolveKeybindings(userConfig),
    appearance: resolveAppearance(userConfig),
    browser: resolveBrowser(userConfig),
    customView: resolveCustomView(userConfig),
    defaultShell: resolveShell(userConfig),
    shellProfiles: resolveShellProfiles(userConfig, detectedShellProfiles),
    layouts: resolveLayouts(userConfig),
    workspaceDefaultCwd: resolveWorkspaceDefaultCwd(userConfig),
  };
}
