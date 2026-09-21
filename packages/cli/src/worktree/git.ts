// gitのワークツリー情報の取得。
//
// IPCを介さずCLIプロセスから直接gitを起動する。niwatermアプリが起動していなくても
// `niwaterm worktree list`が成立する必要があるため（アプリ側へ寄せると、アプリ未起動の
// ターミナルからは一覧が引けなくなる）。
//
// 読み取りは`--porcelain -z`を第一候補にする。行区切りのporcelainは、パスやlockの理由に
// 改行が含まれると壊れるため。-zはgit 2.36以降なので、失敗したら行区切りへ落とす。

import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

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

/** ローカルブランチが既に存在するか */
export async function branchExists(branch: string, cwd: string): Promise<boolean> {
  const result = await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd);
  return result !== null && result.exitCode === 0;
}

/** 一覧からブランチ名でワークツリーを引く。detached・bareはbranchを持たないので当たらない */
export function findWorktreeByBranch(
  worktrees: WorktreeEntry[],
  branch: string,
): WorktreeEntry | null {
  return worktrees.find((worktree) => worktree.branch === branch) ?? null;
}

export type FindWorktreeResult =
  | { kind: "found"; worktree: WorktreeEntry }
  | { kind: "not-found" }
  | { kind: "ambiguous"; candidates: WorktreeEntry[] };

/**
 * ブランチ名・パス・ディレクトリ名のいずれかでワークツリーを引く。
 * 優先順はブランチ名 → パス（相対はcwd基準）→ ディレクトリ名で、当たった段階で確定する。
 * 段階を分けないと、ブランチ名で指定したつもりの文字列が別ワークツリーのディレクトリ名に
 * 一致して化ける。bareはワーキングツリーを持たないので候補から外す
 */
export function findWorktreeByQuery(
  worktrees: WorktreeEntry[],
  query: string,
  cwd: string,
): FindWorktreeResult {
  const candidates = worktrees.filter((entry) => !entry.bare);
  const resolved = resolve(cwd, query);
  const tiers = [
    candidates.filter((entry) => entry.branch === query),
    candidates.filter((entry) => entry.path === resolved),
    candidates.filter((entry) => basename(entry.path) === query),
  ];
  for (const tier of tiers) {
    const first = tier[0];
    if (first === undefined) continue;
    return tier.length === 1
      ? { kind: "found", worktree: first }
      : { kind: "ambiguous", candidates: tier };
  }
  return { kind: "not-found" };
}

export interface AddWorktreeOptions {
  /** gitを実行する作業ディレクトリ。メインワークツリーを渡す */
  repoRoot: string;
  /** 作成先の絶対パス */
  path: string;
  branch: string;
  /**
   * 新規ブランチの分岐元。ブランチが既にある場合は指定できない
   * （gitの`worktree add <path> <branch>`は分岐元を取らないため）
   */
  from?: string;
}

export type AddWorktreeResult = { ok: true } | { ok: false; error: string };

/**
 * ワークツリーを作る。ブランチが未作成なら`-b`で同時に作る。
 * 事前チェックはコマンド側で済ませる前提で、ここではgitのエラーをそのまま返す
 */
export async function addWorktree(opts: AddWorktreeOptions): Promise<AddWorktreeResult> {
  const args = (await branchExists(opts.branch, opts.repoRoot))
    ? ["worktree", "add", opts.path, opts.branch]
    : ["worktree", "add", "-b", opts.branch, opts.path, ...(opts.from ? [opts.from] : [])];
  const result = await runGit(args, opts.repoRoot);
  if (result === null) return { ok: false, error: GIT_NOT_FOUND.error };
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr.trim() || "git worktree addが失敗しました" };
  }
  return { ok: true };
}

/**
 * `git config --get-regexp`で`<prefix>.`で始まる設定をまとめて読む。
 * `-z`を付けるとキーと値が改行で、エントリ同士がNULで区切られるため、値に空白・改行が入っても壊れない。
 * 返すキーはprefixを除いた残り（`niwaterm.worktree.dir`なら`dir`）
 */
export async function gitConfigSection(prefix: string, cwd: string): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  const escaped = prefix.replaceAll(".", "\\.");
  const result = await runGit(["config", "-z", "--get-regexp", `^${escaped}\\.`], cwd);
  // 1件も無ければexitCode 1。エラーと区別する必要は無く、どちらも「設定なし」として扱う
  if (result === null || result.exitCode !== 0) return values;
  for (const entry of result.stdout.split("\0")) {
    if (entry === "") continue;
    const newline = entry.indexOf("\n");
    const key = newline === -1 ? entry : entry.slice(0, newline);
    const value = newline === -1 ? "" : entry.slice(newline + 1);
    if (key.startsWith(`${prefix}.`)) values.set(key.slice(prefix.length + 1), value);
  }
  return values;
}

/** リモートが1つでも設定されているか。未設定なら「未pushのコミット」という概念自体が無い */
export async function hasRemotes(cwd: string): Promise<boolean> {
  const result = await runGit(["remote"], cwd);
  return result !== null && result.exitCode === 0 && result.stdout.trim().length > 0;
}

/**
 * 未コミットの変更（追跡ファイルの変更＋未追跡ファイル）の件数。数えられなければnull。
 * `-z`を使わないのは、`-z`だとリネームが2フィールドに割れて件数が水増しされるため。
 * 行区切りのporcelainは特殊文字を含むパスをgitがC引用符でくるむので、行が壊れる心配はない
 */
export async function countUncommittedChanges(worktreePath: string): Promise<number | null> {
  const result = await runGit(["status", "--porcelain"], worktreePath);
  if (result === null || result.exitCode !== 0) return null;
  return result.stdout.split("\n").filter((line) => line.trim() !== "").length;
}

/**
 * どのリモート追跡ブランチからも辿れないコミットの件数。数えられなければnull。
 * upstreamとの差分ではなくリモート全体との差分を見るのは、upstream未設定のまま作った
 * ローカルブランチ（`worktree new`で作った直後がこれ）でも取りこぼさないため
 */
export async function countUnpushedCommits(repoRoot: string, head: string): Promise<number | null> {
  const result = await runGit(["rev-list", "--count", head, "--not", "--remotes"], repoRoot);
  if (result === null || result.exitCode !== 0) return null;
  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isNaN(count) ? null : count;
}

export interface RemoveWorktreeOptions {
  /** gitを実行する作業ディレクトリ。メインワークツリーを渡す */
  repoRoot: string;
  /** 削除するワークツリーの絶対パス */
  path: string;
  force: boolean;
}

export type RemoveWorktreeResult = { ok: true } | { ok: false; error: string };

/**
 * ワークツリーを削除する（ディレクトリごと消える）。
 * `--force`を2つ渡すのは、ロック済みワークツリーにgitが2つ要求するため。
 * 何が引っかかっているかはコマンド側のガードが先に提示済みで、それを越えてforceが来ている
 */
export async function removeWorktree(opts: RemoveWorktreeOptions): Promise<RemoveWorktreeResult> {
  const force = opts.force ? ["--force", "--force"] : [];
  const result = await runGit(["worktree", "remove", ...force, opts.path], opts.repoRoot);
  if (result === null) return { ok: false, error: GIT_NOT_FOUND.error };
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr.trim() || "git worktree removeが失敗しました" };
  }
  return { ok: true };
}

export interface DeleteBranchOptions {
  repoRoot: string;
  branch: string;
  /** マージ済みかどうかを問わずに消す（`git branch -D`） */
  force: boolean;
}

export type DeleteBranchResult = { ok: true } | { ok: false; error: string };

/** ローカルブランチを削除する。forceでないとgitは未マージのブランチを拒む */
export async function deleteBranch(opts: DeleteBranchOptions): Promise<DeleteBranchResult> {
  const result = await runGit(["branch", opts.force ? "-D" : "-d", opts.branch], opts.repoRoot);
  if (result === null) return { ok: false, error: GIT_NOT_FOUND.error };
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr.trim() || "git branchが失敗しました" };
  }
  return { ok: true };
}
