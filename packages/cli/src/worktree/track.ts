// `worktree new`がワークツリーへ載せるブランチをどこから用意するかを決める層。
//
// リモート名をoriginの決め打ちにしないのは、fork運用（origin/upstream）で使えなくなるため。
// 同じ理由でgitのDWIM（`git worktree add <path> <branch>`が、ローカルに無いブランチ名を
// 同名を持つ唯一のリモートから推測する挙動）にも任せない。あれはリモートが複数あると
// `fatal: invalid reference`で落ちるだけで、どちらのリモートかを選ばせる余地が無い。

import { branchExists, remoteBranchExists, type WorktreeSource } from "./git";

/** ブランチをどこから用意するか。`niwaterm worktree new --track`の値 */
export const WORKTREE_TRACK_MODES = ["auto", "remote", "local", "new"] as const;
export type WorktreeTrackMode = (typeof WORKTREE_TRACK_MODES)[number];

export const DEFAULT_WORKTREE_TRACK_MODE: WorktreeTrackMode = "auto";

export function isWorktreeTrackMode(value: unknown): value is WorktreeTrackMode {
  return WORKTREE_TRACK_MODES.includes(value as WorktreeTrackMode);
}

/** リモート名付きの指定（`origin/feat/x`）を分解した結果 */
export interface SplitRemoteRef {
  /** 先頭に付いていたリモート名。付いていなければnull */
  remote: string | null;
  /** リモート名を除いたブランチ名 */
  branch: string;
}

/**
 * `origin/feat/x`のようなリモート名付きの指定を分解する。`git branch -r`の出力をそのまま
 * 貼れるようにするためのもの。リモート名自体に`/`を含められるので長いものから順に照合する。
 * どのリモートにも当たらなければブランチ名そのものとして扱う
 */
export function splitRemoteRef(input: string, remotes: string[]): SplitRemoteRef {
  for (const remote of [...remotes].sort((a, b) => b.length - a.length)) {
    const prefix = `${remote}/`;
    if (input.startsWith(prefix) && input.length > prefix.length) {
      return { remote, branch: input.slice(prefix.length) };
    }
  }
  return { remote: null, branch: input };
}

export type PickRemoteResult = { ok: true; remote: string } | { ok: false; error: string };

/**
 * リモート名を省略したときに使うリモートを決める。1つならそれ、複数なら`origin`。
 * 複数あって`origin`も無ければ選びようがないのでエラーにする
 */
export function pickDefaultRemote(remotes: string[]): PickRemoteResult {
  const only = remotes[0];
  if (only === undefined) return { ok: false, error: "リモートが設定されていません" };
  if (remotes.length === 1) return { ok: true, remote: only };
  if (remotes.includes("origin")) return { ok: true, remote: "origin" };
  return {
    ok: false,
    error: `リモートが複数あります（${remotes.join(", ")}）。--remoteで指定してください`,
  };
}

export interface ResolveWorktreeSourceOptions {
  /** gitを実行する作業ディレクトリ。メインワークツリーを渡す */
  repoRoot: string;
  /** リモート名を除いたローカルブランチ名 */
  branch: string;
  mode: WorktreeTrackMode;
  /** trackに使うリモート。リモートが無い・既定を決められない場合はnull */
  remote: string | null;
  /** 新規ブランチの分岐元 */
  from?: string;
}

export type ResolveWorktreeSourceResult =
  | { ok: true; source: WorktreeSource }
  | { ok: false; error: string };

/** モードと手元のブランチの有無から、ワークツリーへ載せるブランチの用意の仕方を決める */
export async function resolveWorktreeSource(
  opts: ResolveWorktreeSourceOptions,
): Promise<ResolveWorktreeSourceResult> {
  const newSource: WorktreeSource = {
    kind: "new",
    ...(opts.from !== undefined ? { from: opts.from } : {}),
  };
  switch (opts.mode) {
    case "local": {
      if (await branchExists(opts.branch, opts.repoRoot)) {
        return { ok: true, source: { kind: "local" } };
      }
      return { ok: false, error: `ローカルブランチ ${opts.branch} がありません` };
    }
    case "remote": {
      if (opts.remote === null) return { ok: false, error: "リモートが設定されていません" };
      if (await remoteBranchExists(opts.remote, opts.branch, opts.repoRoot)) {
        return { ok: true, source: { kind: "remote", remote: opts.remote } };
      }
      return { ok: false, error: `リモートブランチ ${opts.remote}/${opts.branch} がありません` };
    }
    case "new": {
      if (await branchExists(opts.branch, opts.repoRoot)) {
        return { ok: false, error: `ブランチ ${opts.branch} は既にあります` };
      }
      return { ok: true, source: newSource };
    }
    case "auto": {
      // ローカルを先に見るのは、同名のローカルブランチがある状態でリモートからの`-b`を試すと
      // gitが弾くため。手元のブランチがあるならそれが作業の続きになる
      if (await branchExists(opts.branch, opts.repoRoot)) {
        return { ok: true, source: { kind: "local" } };
      }
      if (
        opts.remote !== null &&
        (await remoteBranchExists(opts.remote, opts.branch, opts.repoRoot))
      ) {
        return { ok: true, source: { kind: "remote", remote: opts.remote } };
      }
      return { ok: true, source: newSource };
    }
  }
}
