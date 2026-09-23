// プロジェクトローカル設定（<projectRoot>/.niwaterm/config.ts）の解決。
//
// 設計の要点は「.niwaterm/を暗黙に環境から探さない」こと。解決コンテキストは2つだけで、
//
//   1. CLI・API実行時（layout apply、今後のworktree系） … プロセスのcwdは常に1つなので、
//      そこから上向きに探せば解決先が一意に決まる。Board内のタブが何ディレクトリ開いていようと無関係
//   2. 起動時（restoreMode: "layout"） … cwdが存在しないため、紐づけを作った時点の
//      解決元をPersistedBoardStartup.projectRootへ永続化しておき、それをそのまま読む
//
// Board内のタブのcwdから推測する方式は採らない（ユーザーがcdすれば変わるため解決キーとして不安定）。
//
// 探索ルールが複数箇所に散らばると必ず壊れるので、探索はresolveProjectRoot()1つに閉じ込め、
// layout用も今後のworktree用もここを通す。

import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { LayoutPreset, LayoutsConfig, NiwatermProjectConfig } from "@niwaterm/config";
import {
  BUILTIN_LAYOUT_DESCRIPTIONS,
  BUILTIN_LAYOUT_NAMES,
  type BuiltinLayoutName,
  isBuiltinLayoutName,
} from "./builtin-layouts";
import { importFreshConfig, normalizeLayouts } from "./config";

/** プロジェクトルート直下に置く設定ディレクトリ名 */
export const PROJECT_CONFIG_DIR_NAME = ".niwaterm";

/** 設定ディレクトリ内のエントリファイル名（グローバル設定と同じくTypeScript） */
export const PROJECT_CONFIG_ENTRY_NAME = "config.ts";

export function projectConfigDirPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_CONFIG_DIR_NAME);
}

export function projectConfigFilePath(projectRoot: string): string {
  return join(projectConfigDirPath(projectRoot), PROJECT_CONFIG_ENTRY_NAME);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** cwdから上向きに.niwaterm/を探す。ファイルシステムのルートまで遡って見つからなければnull */
async function findUpwards(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  for (;;) {
    if (await isDirectory(join(dir, PROJECT_CONFIG_DIR_NAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * gitのメインワークツリーのルートを返す。`git rev-parse --git-common-dir`はリンクされた
 * ワークツリーからでもメインツリー側の.gitを指すため、その親がメインツリーのルートになる。
 * gitが無い・リポジトリ外・bareリポジトリ等では素直にnullを返す
 */
async function mainWorktreeRoot(cwd: string): Promise<string | null> {
  try {
    // PTYを経由しないspawnにはwindowsHide必須（Windowsで一瞬コンソールウィンドウが開き、
    // niwatermがフォーカスを奪われる。docs/known-issues/windows-spawn-console-window-steals-focus.md）
    const proc = Bun.spawn(["git", "rev-parse", "--git-common-dir"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
    });
    const out = (await new Response(proc.stdout).text()).trim();
    if ((await proc.exited) !== 0 || out.length === 0) return null;
    // メインツリー内で実行すると".git"のような相対パスが返るため、cwd基準で絶対化する
    const gitCommonDir = isAbsolute(out) ? out : resolve(cwd, out);
    const root = dirname(gitCommonDir);
    return root === gitCommonDir ? null : root;
  } catch {
    return null;
  }
}

/**
 * cwdに対応するプロジェクトルート（.niwaterm/を持つディレクトリ）を解決する。
 *
 *   1. cwdから上向きに.niwaterm/を探す
 *   2. 見つからなければ、gitのメインワークツリー側の.niwaterm/も見る
 *      （リンクされたワークツリーには.niwaterm/をコミットしていない、という運用を許容するため）
 *
 * 見つからなければnull（＝グローバル設定のみで解決する）。
 */
export async function resolveProjectRoot(cwd: string | undefined): Promise<string | null> {
  if (!cwd) return null;
  const direct = await findUpwards(cwd);
  if (direct) return direct;
  const mainRoot = await mainWorktreeRoot(cwd);
  if (mainRoot && (await isDirectory(join(mainRoot, PROJECT_CONFIG_DIR_NAME)))) return mainRoot;
  return null;
}

function isNiwatermProjectConfig(value: unknown): value is NiwatermProjectConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if ("layouts" in v) {
    const la = v["layouts"];
    if (typeof la !== "object" || la === null) return false;
  }
  return true;
}

/**
 * <projectRoot>/.niwaterm/config.tsを読み込む。ファイル不在・importエラー・スキーマ不一致の
 * いずれでも例外を投げずnullを返す（loadUserConfigと同じ設計）。
 */
export async function loadProjectConfig(
  projectRoot: string,
): Promise<NiwatermProjectConfig | null> {
  const path = projectConfigFilePath(projectRoot);
  try {
    if (!(await Bun.file(path).exists())) return null;
    const mod = await importFreshConfig(path);
    const candidate = (mod as { default?: unknown }).default ?? mod;
    if (!isNiwatermProjectConfig(candidate)) {
      console.log(`[bun] project config did not export a valid NiwatermProjectConfig: ${path}`);
      return null;
    }
    return candidate;
  } catch (err) {
    console.log(`[bun] failed to load project config (${path}): ${String(err)}`);
    return null;
  }
}

/** <projectRoot>/.niwaterm/config.tsのlayoutsを、グローバル設定と同じ検証を通して返す */
export async function loadProjectLayouts(projectRoot: string): Promise<LayoutsConfig> {
  const config = await loadProjectConfig(projectRoot);
  if (!config) return {};
  return normalizeLayouts(config.layouts, `${projectConfigFilePath(projectRoot)} layouts`);
}

/** プリセット1件と、それがどこから解決されたか */
export type ResolvedLayoutPreset =
  | {
      kind: "config";
      name: string;
      preset: LayoutPreset;
      /** プロジェクトローカル由来ならそのルート。グローバル設定由来ならnull */
      projectRoot: string | null;
    }
  | {
      kind: "builtin";
      name: BuiltinLayoutName;
      /** ビルトインは設定ファイル由来ではないため常にnull（trust判定の対象外） */
      projectRoot: null;
    };

/**
 * プリセット名を解決する。project → global → ビルトインの順で探し、同名はproject側が優先される
 * （どちらが効いたかはResolvedLayoutPreset.projectRootで判別でき、CLI側の表示・trust promptの
 * 要否判定に使う）。ビルトインを最後に見るのは、同名のユーザー定義プリセットを隠さないため。
 */
export async function resolveLayoutPresetByName(
  name: string,
  cwd: string | undefined,
  globalLayouts: LayoutsConfig,
): Promise<ResolvedLayoutPreset | null> {
  const projectRoot = await resolveProjectRoot(cwd);
  if (projectRoot) {
    const preset = (await loadProjectLayouts(projectRoot))[name];
    if (preset) return { kind: "config", name, preset, projectRoot };
  }
  const global = globalLayouts[name];
  if (global) return { kind: "config", name, preset: global, projectRoot: null };
  if (isBuiltinLayoutName(name)) return { kind: "builtin", name, projectRoot: null };
  return null;
}

/** 起動時レイアウト用。永続化済みのprojectRootから直接プリセットを引く（探索は行わない） */
export async function loadProjectPreset(
  projectRoot: string,
  name: string,
): Promise<LayoutPreset | null> {
  return (await loadProjectLayouts(projectRoot))[name] ?? null;
}

export interface LayoutListEntry {
  name: string;
  description?: string;
  /** プロジェクトローカル由来ならそのルート。グローバル設定・ビルトイン由来ならnull */
  projectRoot: string | null;
  /** 設定ファイルではなくビルトイン（builtin-layouts.ts）由来 */
  builtin?: boolean;
}

/**
 * cwdから見えるプリセットを一覧する。同名は優先される側だけを返す（実際にapplyされる方に揃える）。
 * 並び順はproject → global → ビルトインで、その中は名前順
 */
export async function listResolvedLayouts(
  cwd: string | undefined,
  globalLayouts: LayoutsConfig,
): Promise<LayoutListEntry[]> {
  const projectRoot = await resolveProjectRoot(cwd);
  const projectLayouts = projectRoot ? await loadProjectLayouts(projectRoot) : {};
  const toEntry = (name: string, preset: LayoutPreset, root: string | null): LayoutListEntry => {
    const entry: LayoutListEntry = { name, projectRoot: root };
    if (preset.description !== undefined) entry.description = preset.description;
    return entry;
  };
  const projectEntries = Object.entries(projectLayouts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, preset]) => toEntry(name, preset, projectRoot));
  const globalEntries = Object.entries(globalLayouts)
    .filter(([name]) => !(name in projectLayouts))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, preset]) => toEntry(name, preset, null));
  const builtinEntries = BUILTIN_LAYOUT_NAMES.filter(
    (name) => !(name in projectLayouts) && !(name in globalLayouts),
  ).map((name) => ({
    name,
    description: BUILTIN_LAYOUT_DESCRIPTIONS[name],
    projectRoot: null,
    builtin: true,
  }));
  return [...projectEntries, ...globalEntries, ...builtinEntries];
}

/**
 * レイアウトプリセットのtabConfig.cwdを解決する。
 * 相対パスはbase（プロジェクトローカルならprojectRoot、そうでなければCLIのcwd）基準で解決し、
 * 未指定ならbaseそのものを使う（baseも無ければundefinedを返し、newTab側の既定＝ホームに委ねる）
 */
export function resolveTabCwd(
  tabCwd: string | undefined,
  base: string | undefined,
): string | undefined {
  if (tabCwd === undefined) return base;
  if (isAbsolute(tabCwd)) return tabCwd;
  return base ? resolve(base, tabCwd) : tabCwd;
}
