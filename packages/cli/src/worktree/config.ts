// ワークツリー設定（置き場所テンプレート・開き方・レイアウトプリセット・作成後フック）を、
// どの設定から採るか決める層。
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
// プロジェクトローカル設定は**承認済みのリポジトリでだけ**読む（worktree/trust.ts）。cloneしてきた
// リポジトリのTypeScriptがimportだけで走るため、承認はimportの前に取る。未承認ならこのレイヤーごと
// 無かったものとして扱う。
//
// 値（dir・open・layout・fetch）は上書きだが、フック（onCreate・onOpen）は**グローバル→プロジェクトの順に
// 両方走る**。
// 値は「どれか1つが効く」が自然なのに対し、フックは行動であって上書きが不自然なため
// （グローバルは自分の習慣、プロジェクトはそのリポジトリの手順、と役割が違う）。
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

/** ワークツリーを作る前にリモートをfetchするか */
export const DEFAULT_WORKTREE_FETCH = true;

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
  /** Boardを新規に作るときに適用するレイアウトプリセット名。既定は無指定（undefined） */
  layout: ResolvedSetting<string | undefined>;
  /** ワークツリーを作る前にリモートをfetchするか */
  fetch: ResolvedSetting<boolean>;
  /** 実行順に並んだフック。該当が無ければ空配列 */
  onCreate: WorktreeHook[];
  /** Boardを新規に作った後のフック。onCreateと同じく実行順に並ぶ */
  onOpen: WorktreeOpenHook[];
}

/** 設定ファイルから読めるworktreeセクションの生の形 */
export interface WorktreeSettingsInput {
  dir?: string;
  open?: WorktreeOpenMode;
  layout?: string;
  fetch?: boolean;
  onCreate?: WorktreeHook;
  onOpen?: WorktreeOpenHook;
}

/** ワークツリー作成後に走るフック。設定ファイルがdefault exportするTypeScriptの関数 */
export type WorktreeHook = (ctx: WorktreeHookContext) => void | Promise<void>;

export interface WorktreeHookContext {
  /** メインワークツリーのパス */
  repoRoot: string;
  /** 作成したワークツリーのパス */
  worktreePath: string;
  branch: string;
}

/** ワークツリーのBoardを新規に作った後に走るフック */
export type WorktreeOpenHook = (ctx: WorktreeOpenHookContext) => void | Promise<void>;

export interface WorktreeOpenHookContext {
  /** メインワークツリーのパス */
  repoRoot: string;
  /** 開いたワークツリーのパス */
  worktreePath: string;
  /** detached HEADのワークツリーはnull */
  branch: string | null;
  /** 今回の`worktree new`でワークツリーを新規作成したか */
  created: boolean;
  workspaceId: string;
  boardId: string;
  /** Boardのタブ（レイアウトプリセット適用後）。タイルの並び順 */
  tabIds: string[];
}

/** 1つの設定ソースから読めた値。読めなかった項目はundefinedのまま次のソースへ譲る */
interface WorktreeConfigLayer {
  source: WorktreeSettingSource;
  dir: string | undefined;
  open: WorktreeOpenMode | undefined;
  layout: string | undefined;
  fetch: boolean | undefined;
  onCreate: WorktreeHook | undefined;
  onOpen: WorktreeOpenHook | undefined;
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

const GIT_CONFIG_TRUE = ["true", "yes", "on", "1"];
const GIT_CONFIG_FALSE = ["false", "no", "off", "0"];

/** git configのbool表記を解釈する。gitが受け付ける綴りに揃える。解釈できなければundefined */
function gitConfigBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (GIT_CONFIG_TRUE.includes(normalized)) return true;
  if (GIT_CONFIG_FALSE.includes(normalized)) return false;
  return undefined;
}

/** 設定オブジェクトのworktreeセクションを取り出す。形が違う項目は落とす（設定全体は検証しない） */
export function pickWorktreeSettings(config: unknown): WorktreeSettingsInput {
  if (typeof config !== "object" || config === null) return {};
  const worktree = (config as { worktree?: unknown }).worktree;
  if (typeof worktree !== "object" || worktree === null) return {};
  const raw = worktree as {
    dir?: unknown;
    open?: unknown;
    layout?: unknown;
    fetch?: unknown;
    onCreate?: unknown;
    onOpen?: unknown;
  };
  const dir = nonEmptyString(raw.dir);
  const layout = nonEmptyString(raw.layout);
  return {
    ...(dir !== undefined ? { dir } : {}),
    ...(isWorktreeOpenMode(raw.open) ? { open: raw.open } : {}),
    ...(layout !== undefined ? { layout } : {}),
    ...(typeof raw.fetch === "boolean" ? { fetch: raw.fetch } : {}),
    ...(typeof raw.onCreate === "function" ? { onCreate: raw.onCreate as WorktreeHook } : {}),
    ...(typeof raw.onOpen === "function" ? { onOpen: raw.onOpen as WorktreeOpenHook } : {}),
  };
}

/**
 * 設定ファイルをimportしてworktreeセクションを読む。ファイル不在・importエラー・形の不一致は
 * いずれも空で返して次の候補へ譲る（設定が壊れていてもワークツリー操作自体は続けられるように）
 */
export async function readWorktreeSettingsFromFile(path: string): Promise<WorktreeSettingsInput> {
  try {
    if (!(await Bun.file(path).exists())) return {};
    const mod: unknown = await import(pathToFileURL(path).href);
    return pickWorktreeSettings((mod as { default?: unknown }).default ?? mod);
  } catch {
    return {};
  }
}

function toLayer(source: WorktreeSettingSource, input: WorktreeSettingsInput): WorktreeConfigLayer {
  return {
    source,
    dir: input.dir,
    open: input.open,
    layout: input.layout,
    fetch: input.fetch,
    onCreate: input.onCreate,
    onOpen: input.onOpen,
  };
}

async function loadLayers(
  sources: WorktreeDirSources,
  opts: ResolveWorktreeSettingsOptions,
): Promise<WorktreeConfigLayer[]> {
  // 未承認のリポジトリではimportもしない（importでトップレベルのコードが走るため）
  const project = opts.includeProject
    ? await readWorktreeSettingsFromFile(sources.projectConfigPath)
    : {};
  const global = await readWorktreeSettingsFromFile(sources.globalConfigPath);
  const gitConfig = await gitConfigSection(WORKTREE_CONFIG_PREFIX, sources.gitCwd);
  const gitOpen = gitConfig.get("open");
  const gitDir = nonEmptyString(gitConfig.get("dir"));
  const gitLayout = nonEmptyString(gitConfig.get("layout"));
  const gitFetch = gitConfigBool(gitConfig.get("fetch"));
  return [
    toLayer("project", project),
    toLayer("global", global),
    toLayer("git-config", {
      ...(gitDir !== undefined ? { dir: gitDir } : {}),
      ...(isWorktreeOpenMode(gitOpen) ? { open: gitOpen } : {}),
      ...(gitLayout !== undefined ? { layout: gitLayout } : {}),
      ...(gitFetch !== undefined ? { fetch: gitFetch } : {}),
    }),
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

/** フックを上書きせず、グローバル→プロジェクトの順（走る順）に積む */
function stackHooks<T>(
  layers: WorktreeConfigLayer[],
  read: (layer: WorktreeConfigLayer) => T | undefined,
): T[] {
  return [...layers].reverse().flatMap((layer) => {
    const hook = read(layer);
    return hook === undefined ? [] : [hook];
  });
}

export interface ResolveWorktreeSettingsOptions {
  /** プロジェクトローカル設定を読んでよいか（worktree/trust.tsの承認結果） */
  includeProject: boolean;
}

/** ワークツリー設定を解決する */
export async function resolveWorktreeSettings(
  sources: WorktreeDirSources,
  opts: ResolveWorktreeSettingsOptions,
): Promise<ResolvedWorktreeSettings> {
  const layers = await loadLayers(sources, opts);
  return {
    dir: pickLayer(layers, (layer) => layer.dir, DEFAULT_WORKTREE_DIR_TEMPLATE),
    open: pickLayer(layers, (layer) => layer.open, DEFAULT_WORKTREE_OPEN_MODE),
    layout: pickLayer<string | undefined>(layers, (layer) => layer.layout, undefined),
    fetch: pickLayer(layers, (layer) => layer.fetch, DEFAULT_WORKTREE_FETCH),
    onCreate: stackHooks(layers, (layer) => layer.onCreate),
    onOpen: stackHooks(layers, (layer) => layer.onOpen),
  };
}

export interface ResolvedWorktreePlan extends ResolvedWorktreeSettings {
  /** 新規ワークツリーを作る絶対パス */
  path: string;
}

/** 設定の解決からパスの展開までをまとめて行う。worktree系コマンドの入口 */
export async function resolveWorktreePlan(
  ctx: WorktreePathContext,
  opts: ResolveWorktreeSettingsOptions,
): Promise<ResolvedWorktreePlan> {
  const settings = await resolveWorktreeSettings(worktreeDirSourcesFor(ctx.repoRoot), opts);
  return { ...settings, path: expandWorktreeDirTemplate(settings.dir.value, ctx) };
}
