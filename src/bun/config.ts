// ユーザー設定ファイル（~/.config/niwaterm/niwaterm.config.ts）の読み込み。
// ファイル不在・importエラー・スキーマ不一致いずれでも例外を投げずnullを返す（persistence.tsのloadPersistedStateと同じ設計）。

import { homedir } from "node:os";
import { join } from "node:path";
import {
  defaultAppearance,
  defaultBrowserConfig,
  defaultKeybindings,
  isKeybindAction,
  type KeyBindingString,
  type KeybindingsConfig,
  type NiwatermConfig,
  parseKeyBindingString,
  type ResolvedAppearanceConfig,
  type ResolvedBrowserConfig,
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
 * defaultKeybindingsにユーザー設定をマージし、不正エントリを警告付きで除外した最終テーブルを返す。
 * 1箇所のtypoで全キーバインドがデフォルトに落ちるのを防ぐため、エントリ単位で検証する。
 */
export function resolveKeybindings(userConfig: NiwatermConfig | null): KeybindingsConfig {
  const merged: Record<string, unknown> = {
    ...defaultKeybindings,
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

/** 設定ファイルを読み込み、キーバインド・外観・ブラウザ設定を解決する（起動時・ホットリロード時共通） */
export async function loadAndResolveConfig(path: string): Promise<{
  keybindings: KeybindingsConfig;
  appearance: ResolvedAppearanceConfig;
  browser: ResolvedBrowserConfig;
}> {
  const userConfig = await loadUserConfig(path);
  return {
    keybindings: resolveKeybindings(userConfig),
    appearance: resolveAppearance(userConfig),
    browser: resolveBrowser(userConfig),
  };
}
