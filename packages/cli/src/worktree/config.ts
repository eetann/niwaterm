// ワークツリー設定（置き場所テンプレート・作成後の開き方）を、どの設定から採るか決める層。
//
// 優先順位は項目ごとに独立して次のとおり。
//
//   1. <repoRoot>/.niwaterm/config.ts の worktree.*  … そのリポジトリ固有の方針
//   2. ~/.config/niwaterm/niwaterm.config.ts の worktree.*  … ユーザー共通の方針
//   3. git config の niwaterm.worktree.*  … gtr（git-worktree-runner）と同じ流儀
//   4. 既定値
//
// git configを一番弱くしているのは、niwatermの設定の正本がniwaterm.config.tsであり、
// git configはniwatermを入れていない環境とも設定を共有したい人向けの補助口だから。
// git config内部のローカル/グローバルの優先順位はgit自身が解決するので、ここでは段階を持たない。
//
// 項目ごとに独立して解決するので、「dirはグローバル設定、openはこのリポジトリだけ別」のような
// 混ぜ方ができる。
//
// プロジェクトローカル設定はcwdから上向きに探さず、メインワークツリー直下だけを見る。
// 置き場所・開き方はリポジトリ全体の方針であってワークツリーごとに変わるものではないため
// （アプリ側resolveProjectRoot()がリンクされたワークツリーからメインツリーの.niwaterm/へ
// フォールバックするのと同じ結論になる）。
//
// 設定ファイルの読み込みはsrc/bun/config.ts・project-config.tsにも実装があるが、このパッケージは
// 別ワークスペースパッケージでsrc/bunをimportできないため、意図的に重複させている
// （ipc-client.tsのipcSocketPath()・init.tsのconfigDirPath()と同じ方針）。
// アプリ側のimportFreshConfig()のような一時ディレクトリへのコピーは行わない。あれはBunの
// import()キャッシュを回避してホットリロードするための仕掛けで、1回で終わるCLIプロセスには要らない。

import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gitConfigSection } from "./git";
import {
  DEFAULT_WORKTREE_DIR_TEMPLATE,
  expandWorktreeDirTemplate,
  type WorktreePathContext,
} from "./path";

export const WORKTREE_CONFIG_PREFIX = "niwaterm.worktree";

/** ワークツリーを作った後、それをniwatermのどこで開くか */
export const WORKTREE_OPEN_MODES = ["board", "board-switch", "current-tab", "none"] as const;
export type WorktreeOpenMode = (typeof WORKTREE_OPEN_MODES)[number];

export const DEFAULT_WORKTREE_OPEN_MODE: WorktreeOpenMode = "board";

export function isWorktreeOpenMode(value: unknown): value is WorktreeOpenMode {
  return WORKTREE_OPEN_MODES.includes(value as WorktreeOpenMode);
}

/** 設定項目がどこで決まったか。メッセージや切り分けに使う */
export type WorktreeSettingSource = "project" | "global" | "git-config" | "default";

export interface ResolvedSetting<T> {
  value: T;
  source: WorktreeSettingSource;
}

export interface ResolvedWorktreeSettings {
  dir: ResolvedSetting<string>;
  open: ResolvedSetting<WorktreeOpenMode>;
}

/** 1つの設定ソースから読めた値。読めなかった項目はundefinedのまま次のソースへ譲る */
interface WorktreeConfigLayer {
  source: WorktreeSettingSource;
  dir: string | undefined;
  open: WorktreeOpenMode | undefined;
}

/** テンプレートを探す先。呼び出し側が明示的に渡す（既定はworktreeDirSourcesFor()で組む） */
export interface WorktreeDirSources {
  projectConfigPath: string;
  globalConfigPath: string;
  /** git configを引くときの作業ディレクトリ。リポジトリローカルの設定を効かせるため中を指す */
  gitCwd: string;
}

/** メインワークツリーのパスから既定の探索先を組む */
export function worktreeDirSourcesFor(repoRoot: string): WorktreeDirSources {
  return {
    projectConfigPath: join(repoRoot, ".niwaterm", "config.ts"),
    globalConfigPath: join(homedir(), ".config", "niwaterm", "niwaterm.config.ts"),
    gitCwd: repoRoot,
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 設定オブジェクトのworktreeセクションを取り出す。形が違う項目は落とす（設定全体は検証しない） */
export function pickWorktreeSettings(config: unknown): { dir?: string; open?: WorktreeOpenMode } {
  if (typeof config !== "object" || config === null) return {};
  const worktree = (config as { worktree?: unknown }).worktree;
  if (typeof worktree !== "object" || worktree === null) return {};
  const raw = worktree as { dir?: unknown; open?: unknown };
  const dir = nonEmptyString(raw.dir);
  return {
    ...(dir !== undefined ? { dir } : {}),
    ...(isWorktreeOpenMode(raw.open) ? { open: raw.open } : {}),
  };
}

/**
 * 設定ファイルをimportしてworktreeセクションを読む。ファイル不在・importエラー・形の不一致は
 * いずれも空で返して次の候補へ譲る（設定が壊れていてもワークツリー操作自体は続けられるように）
 */
export async function readWorktreeSettingsFromFile(
  path: string,
): Promise<{ dir?: string; open?: WorktreeOpenMode }> {
  try {
    if (!(await Bun.file(path).exists())) return {};
    const mod: unknown = await import(pathToFileURL(path).href);
    return pickWorktreeSettings((mod as { default?: unknown }).default ?? mod);
  } catch {
    return {};
  }
}

async function loadLayers(sources: WorktreeDirSources): Promise<WorktreeConfigLayer[]> {
  const project = await readWorktreeSettingsFromFile(sources.projectConfigPath);
  const global = await readWorktreeSettingsFromFile(sources.globalConfigPath);
  const gitConfig = await gitConfigSection(WORKTREE_CONFIG_PREFIX, sources.gitCwd);
  const gitOpen = gitConfig.get("open");
  return [
    { source: "project", dir: project.dir, open: project.open },
    { source: "global", dir: global.dir, open: global.open },
    {
      source: "git-config",
      dir: nonEmptyString(gitConfig.get("dir")),
      open: isWorktreeOpenMode(gitOpen) ? gitOpen : undefined,
    },
  ];
}

function pickLayer<T>(
  layers: WorktreeConfigLayer[],
  read: (layer: WorktreeConfigLayer) => T | undefined,
  fallback: T,
): ResolvedSetting<T> {
  for (const layer of layers) {
    const value = read(layer);
    if (value !== undefined) return { value, source: layer.source };
  }
  return { value: fallback, source: "default" };
}

/** ワークツリー設定を解決する */
export async function resolveWorktreeSettings(
  sources: WorktreeDirSources,
): Promise<ResolvedWorktreeSettings> {
  const layers = await loadLayers(sources);
  return {
    dir: pickLayer(layers, (layer) => layer.dir, DEFAULT_WORKTREE_DIR_TEMPLATE),
    open: pickLayer(layers, (layer) => layer.open, DEFAULT_WORKTREE_OPEN_MODE),
  };
}

export interface ResolvedWorktreePlan {
  /** 新規ワークツリーを作る絶対パス */
  path: string;
  dir: ResolvedSetting<string>;
  open: ResolvedSetting<WorktreeOpenMode>;
}

/** 設定の解決からパスの展開までをまとめて行う。worktree系コマンドの入口 */
export async function resolveWorktreePlan(ctx: WorktreePathContext): Promise<ResolvedWorktreePlan> {
  const settings = await resolveWorktreeSettings(worktreeDirSourcesFor(ctx.repoRoot));
  return {
    path: expandWorktreeDirTemplate(settings.dir.value, ctx),
    dir: settings.dir,
    open: settings.open,
  };
}
