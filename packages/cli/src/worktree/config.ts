// 新規ワークツリーの置き場所テンプレートを、どの設定から採るか決める層。
//
// 優先順位は次のとおり。
//
//   1. <repoRoot>/.niwaterm/config.ts の worktree.dir  … そのリポジトリ固有の置き方
//   2. ~/.config/niwaterm/niwaterm.config.ts の worktree.dir … ユーザー共通の置き方
//   3. git config の niwaterm.worktree.dir … gtr（git-worktree-runner）と同じ流儀
//   4. 既定値 DEFAULT_WORKTREE_DIR_TEMPLATE
//
// git configを一番弱くしているのは、niwatermの設定の正本はniwaterm.config.tsであり、
// git configはniwatermを入れていない環境とも共存させたい人向けの補助口だから。
// git config内部のローカル/グローバルの優先順位はgit自身が解決するので、ここでは段階を持たない。
//
// プロジェクトローカル設定はcwdから上向きに探さず、メインワークツリー直下だけを見る。
// 置き場所はリポジトリ全体の方針であってワークツリーごとに変わるものではないため
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
import { gitConfigValue } from "./git";
import {
  DEFAULT_WORKTREE_DIR_TEMPLATE,
  expandWorktreeDirTemplate,
  type WorktreePathContext,
} from "./path";

export const WORKTREE_DIR_CONFIG_KEY = "niwaterm.worktree.dir";

/** テンプレートがどこで決まったか。`worktree new`のメッセージや切り分けに使う */
export type WorktreeDirSource = "project" | "global" | "git-config" | "default";

export interface ResolvedWorktreeDirTemplate {
  template: string;
  source: WorktreeDirSource;
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

/** 設定オブジェクトからworktree.dirを取り出す。形が違えばnull（設定全体は検証しない） */
export function pickWorktreeDir(config: unknown): string | null {
  if (typeof config !== "object" || config === null) return null;
  const worktree = (config as { worktree?: unknown }).worktree;
  if (typeof worktree !== "object" || worktree === null) return null;
  const dir = (worktree as { dir?: unknown }).dir;
  return typeof dir === "string" && dir.length > 0 ? dir : null;
}

/**
 * 設定ファイルをimportしてworktree.dirを読む。ファイル不在・importエラー・形の不一致は
 * いずれもnullを返して次の候補へ譲る（設定が壊れていてもワークツリー操作自体は続けられるように）
 */
export async function readWorktreeDirFromFile(path: string): Promise<string | null> {
  try {
    if (!(await Bun.file(path).exists())) return null;
    const mod: unknown = await import(pathToFileURL(path).href);
    return pickWorktreeDir((mod as { default?: unknown }).default ?? mod);
  } catch {
    return null;
  }
}

/** 置き場所テンプレートを解決する */
export async function resolveWorktreeDirTemplate(
  sources: WorktreeDirSources,
): Promise<ResolvedWorktreeDirTemplate> {
  const project = await readWorktreeDirFromFile(sources.projectConfigPath);
  if (project) return { template: project, source: "project" };

  const global = await readWorktreeDirFromFile(sources.globalConfigPath);
  if (global) return { template: global, source: "global" };

  const fromGit = await gitConfigValue(WORKTREE_DIR_CONFIG_KEY, sources.gitCwd);
  if (fromGit) return { template: fromGit, source: "git-config" };

  return { template: DEFAULT_WORKTREE_DIR_TEMPLATE, source: "default" };
}

export interface ResolvedWorktreePath extends ResolvedWorktreeDirTemplate {
  /** 新規ワークツリーを作る絶対パス */
  path: string;
}

/** 置き場所テンプレートの解決から展開までをまとめて行う。worktree系コマンドの入口 */
export async function resolveWorktreePath(ctx: WorktreePathContext): Promise<ResolvedWorktreePath> {
  const resolved = await resolveWorktreeDirTemplate(worktreeDirSourcesFor(ctx.repoRoot));
  return { ...resolved, path: expandWorktreeDirTemplate(resolved.template, ctx) };
}
