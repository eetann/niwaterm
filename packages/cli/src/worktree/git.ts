// gitのワークツリー情報の取得。
//
// IPCを介さずCLIプロセスから直接gitを起動する。niwatermアプリが起動していなくても
// `niwaterm worktree list`が成立する必要があるため（アプリ側へ寄せると、アプリ未起動の
// ターミナルからは一覧が引けなくなる）。
//
// 読み取りは`--porcelain -z`を第一候補にする。行区切りのporcelainは、パスやlockの理由に
// 改行が含まれると壊れるため。-zはgit 2.36以降なので、失敗したら行区切りへ落とす。

import { stat } from "node:fs/promises";

const WORKTREE_FIELD_PREFIX = "worktree ";
const HEAD_FIELD_PREFIX = "HEAD ";
const BRANCH_FIELD_PREFIX = "branch ";
const LOCKED_FIELD_PREFIX = "locked ";
const PRUNABLE_FIELD_PREFIX = "prunable ";
const LOCAL_BRANCH_REF_PREFIX = "refs/heads/";

/** `git worktree list --porcelain`の1レコード */
export interface WorktreeEntry {
  /** ワークツリーのパス（gitが絶対パスで返す） */
  path: string;
  /** チェックアウト中のローカルブランチ名。detached HEAD・bareではnull */
  branch: string | null;
  /** HEADのコミットハッシュ。bareではnull */
  head: string | null;
  detached: boolean;
  bare: boolean;
  /** `git worktree lock`済み。理由を伴わないロックもあるためlockedReasonとは別に持つ */
  locked: boolean;
  lockedReason: string | null;
  /** `git worktree prune`の対象。実体ディレクトリを消したまま放置した場合など */
  prunable: boolean;
  prunableReason: string | null;
  /** メインワークツリーかどうか */
  main: boolean;
}

export type WorktreeErrorKind =
  | "git-not-found"
  | "invalid-cwd"
  | "not-a-repository"
  | "unsupported-git"
  | "git-failed";

export type ListWorktreesResult =
  | { ok: true; worktrees: WorktreeEntry[] }
  | { ok: false; kind: WorktreeErrorKind; error: string };

interface GitRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** gitを起動して結果を返す。gitコマンド自体を起動できなければnull */
async function runGit(args: string[], cwd: string): Promise<GitRunResult | null> {
  try {
    // PTYを経由しないspawnにはwindowsHide必須（Windowsで一瞬コンソールウィンドウが開き、
    // niwatermがフォーカスを奪われる。docs/known-issues/windows-spawn-console-window-steals-focus.md）
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode: await proc.exited, stdout, stderr };
  } catch {
    return null;
  }
}

/**
 * フィールド列をレコード単位へ切り分ける。porcelainはレコードを空フィールドで区切るが、
 * 最終レコードに区切りが付かない実装差に備え、次のworktreeフィールドでも区切る
 */
function splitRecords(output: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let current: string[] = [];
  for (const rawField of output.split(delimiter)) {
    // 行区切り時のCRLFを落とす（-z時は改行自体がフィールドの一部なので触らない）
    const field = delimiter === "\n" ? rawField.replace(/\r$/, "") : rawField;
    if (field === "") {
      if (current.length > 0) records.push(current);
      current = [];
      continue;
    }
    if (field.startsWith(WORKTREE_FIELD_PREFIX) && current.length > 0) {
      records.push(current);
      current = [];
    }
    current.push(field);
  }
  if (current.length > 0) records.push(current);
  return records;
}

function toEntry(fields: string[], main: boolean): WorktreeEntry | null {
  const pathField = fields.find((field) => field.startsWith(WORKTREE_FIELD_PREFIX));
  if (pathField === undefined) return null;
  const entry: WorktreeEntry = {
    path: pathField.slice(WORKTREE_FIELD_PREFIX.length),
    branch: null,
    head: null,
    detached: false,
    bare: false,
    locked: false,
    lockedReason: null,
    prunable: false,
    prunableReason: null,
    main,
  };
  for (const field of fields) {
    if (field.startsWith(HEAD_FIELD_PREFIX)) {
      entry.head = field.slice(HEAD_FIELD_PREFIX.length);
    } else if (field.startsWith(BRANCH_FIELD_PREFIX)) {
      const ref = field.slice(BRANCH_FIELD_PREFIX.length);
      entry.branch = ref.startsWith(LOCAL_BRANCH_REF_PREFIX)
        ? ref.slice(LOCAL_BRANCH_REF_PREFIX.length)
        : ref;
    } else if (field === "detached") {
      entry.detached = true;
    } else if (field === "bare") {
      entry.bare = true;
    } else if (field === "locked") {
      entry.locked = true;
    } else if (field.startsWith(LOCKED_FIELD_PREFIX)) {
      entry.locked = true;
      entry.lockedReason = field.slice(LOCKED_FIELD_PREFIX.length);
    } else if (field === "prunable") {
      entry.prunable = true;
    } else if (field.startsWith(PRUNABLE_FIELD_PREFIX)) {
      entry.prunable = true;
      entry.prunableReason = field.slice(PRUNABLE_FIELD_PREFIX.length);
    }
  }
  return entry;
}

/**
 * `git worktree list --porcelain`の出力をパースする。
 * delimiterは`-z`付きなら"\0"、無しなら"\n"。
 * 先頭レコードをメインワークツリーとして扱う（gitはcwdがどのワークツリーであっても
 * メインを必ず先頭に出す）
 */
export function parseWorktreePorcelain(output: string, delimiter: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const fields of splitRecords(output, delimiter)) {
    const entry = toEntry(fields, entries.length === 0);
    if (entry) entries.push(entry);
  }
  return entries;
}

function classifyGitError(stderr: string): { kind: WorktreeErrorKind; error: string } {
  const message = stderr.trim();
  if (/not a git repository/i.test(message)) {
    return { kind: "not-a-repository", error: "gitリポジトリではありません" };
  }
  if (/is not a git command/i.test(message)) {
    return {
      kind: "unsupported-git",
      error: "このgitは`git worktree`に対応していません（git 2.7以降が必要です）",
    };
  }
  return { kind: "git-failed", error: message || "gitが失敗しました" };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

const GIT_NOT_FOUND: { kind: WorktreeErrorKind; error: string } = {
  kind: "git-not-found",
  error: "gitコマンドを起動できませんでした（PATHにgitがあるか確認してください）",
};

/** cwdが属するリポジトリのワークツリーを列挙する。先頭は必ずメインワークツリー */
export async function listWorktrees(cwd: string): Promise<ListWorktreesResult> {
  if (!(await isDirectory(cwd))) {
    return { ok: false, kind: "invalid-cwd", error: `ディレクトリが存在しません: ${cwd}` };
  }
  const withZ = await runGit(["worktree", "list", "--porcelain", "-z"], cwd);
  if (withZ === null) return { ok: false, ...GIT_NOT_FOUND };
  if (withZ.exitCode === 0) {
    return { ok: true, worktrees: parseWorktreePorcelain(withZ.stdout, "\0") };
  }
  const plain = await runGit(["worktree", "list", "--porcelain"], cwd);
  if (plain === null) return { ok: false, ...GIT_NOT_FOUND };
  if (plain.exitCode !== 0) return { ok: false, ...classifyGitError(plain.stderr) };
  return { ok: true, worktrees: parseWorktreePorcelain(plain.stdout, "\n") };
}

/** 一覧からメインワークツリーを取り出す（追加のgit起動は不要） */
export function mainWorktree(worktrees: WorktreeEntry[]): WorktreeEntry | null {
  return worktrees.find((worktree) => worktree.main) ?? null;
}

/**
 * リポジトリのルート＝メインワークツリーのパスを解決する。
 * 新規ワークツリーの置き場所（worktree/path.ts）はここを基準に決まる
 */
export async function resolveRepoRoot(
  cwd: string,
): Promise<{ ok: true; repoRoot: string } | { ok: false; kind: WorktreeErrorKind; error: string }> {
  const result = await listWorktrees(cwd);
  if (!result.ok) return result;
  const main = mainWorktree(result.worktrees);
  if (!main) {
    return {
      ok: false,
      kind: "not-a-repository",
      error: "メインワークツリーを特定できませんでした",
    };
  }
  return { ok: true, repoRoot: main.path };
}

/** `git config <key>`の値を読む。未設定・エラーならnull */
export async function gitConfigValue(key: string, cwd: string): Promise<string | null> {
  const result = await runGit(["config", "--get", key], cwd);
  if (result === null || result.exitCode !== 0) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

/** 一覧表示・スクリプト向けのフラグ列。該当が無ければ空配列 */
export function worktreeFlags(entry: WorktreeEntry): string[] {
  const flags: string[] = [];
  if (entry.main) flags.push("main");
  if (entry.bare) flags.push("bare");
  if (entry.detached) flags.push("detached");
  if (entry.locked) flags.push("locked");
  if (entry.prunable) flags.push("prunable");
  return flags;
}
