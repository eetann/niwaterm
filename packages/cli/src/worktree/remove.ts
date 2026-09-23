// ワークツリー削除の対象解決とガード判定。
//
// `git worktree remove`自体は未コミットの変更とロックしか見ず、未pushのコミットは黙って消す
// （ワークツリーを消してもブランチは残るが、--delete-branchと組み合わせると取り返しがつかない）。
// 消えて困るものを一通り数え、何が引っかかっているかを並べてから--forceを要求する。

import { resolve, sep } from "node:path";
import {
  countUncommittedChanges,
  countUnpushedCommits,
  findWorktreeByQuery,
  hasRemotes,
  type WorktreeEntry,
} from "./git";

/** 数えられなかった観点。ガード側では「安全側に倒して止める」として扱う */
export const UNKNOWN = "unknown";
/** リモートが1つも無いリポジトリ。push先が無いので未pushという概念が成り立たない */
export const NO_REMOTE = "no-remote";

export interface WorktreeRemovalState {
  /** 未コミットの変更（追跡ファイルの変更＋未追跡ファイル）の件数 */
  uncommitted: number | typeof UNKNOWN;
  /** どのリモート追跡ブランチからも辿れないコミットの件数 */
  unpushed: number | typeof UNKNOWN | typeof NO_REMOTE;
  locked: boolean;
  lockedReason: string | null;
  /** 実体ディレクトリが既に無い（`git worktree prune`の対象） */
  prunable: boolean;
}

/**
 * `--force`無しでは削除できない理由を並べる。空配列なら削除してよい。
 * 文言はそのままユーザーへ出す
 */
export function removalBlockers(state: WorktreeRemovalState): string[] {
  const blockers: string[] = [];
  // 実体ディレクトリが無いワークツリーは中身を問えない。消すこと自体が後始末なので通す
  if (!state.prunable) {
    if (state.uncommitted === UNKNOWN) {
      blockers.push("未コミットの変更があるか判定できませんでした");
    } else if (state.uncommitted > 0) {
      blockers.push(`未コミットの変更が${state.uncommitted}件あります（ワークツリーごと消えます）`);
    }
  }
  if (state.unpushed === UNKNOWN) {
    blockers.push("未pushのコミットがあるか判定できませんでした");
  } else if (state.unpushed !== NO_REMOTE && state.unpushed > 0) {
    blockers.push(`どのリモートにも無いコミットが${state.unpushed}件あります`);
  }
  if (state.locked) {
    blockers.push(
      state.lockedReason === null
        ? "ワークツリーがロックされています"
        : `ワークツリーがロックされています: ${state.lockedReason}`,
    );
  }
  return blockers;
}

/** ガード判定に必要な情報をgitから集める */
export async function inspectWorktree(
  repoRoot: string,
  entry: WorktreeEntry,
): Promise<WorktreeRemovalState> {
  const uncommitted = entry.prunable ? 0 : await countUncommittedChanges(entry.path);
  let unpushed: number | typeof UNKNOWN | typeof NO_REMOTE = NO_REMOTE;
  if (entry.head !== null && (await hasRemotes(repoRoot))) {
    unpushed = (await countUnpushedCommits(repoRoot, entry.head)) ?? UNKNOWN;
  }
  return {
    uncommitted: uncommitted ?? UNKNOWN,
    unpushed,
    locked: entry.locked,
    lockedReason: entry.lockedReason,
    prunable: entry.prunable,
  };
}

/**
 * cwdがそのワークツリーの中かどうか。
 * Windowsはカレントディレクトリにしているプロセスがあるとディレクトリを削除できないため、
 * 削除前にCLI自身のcwdを外へ逃がす判定に使う
 */
export function isInsideWorktree(worktreePath: string, cwd: string): boolean {
  const base = resolve(worktreePath);
  const target = resolve(cwd);
  return target === base || target.startsWith(base + sep);
}

export type RemovalTargetsResult =
  | { ok: true; targets: WorktreeEntry[] }
  | { ok: false; errors: string[] };

/**
 * 削除対象の指定をワークツリーへ解決する。1つでも解決できなければ理由を全部並べて返し、
 * 対象は返さない（一部だけ消えた中途半端な状態を作らないため、解決は全部揃ってから削除へ進む）。
 * 同じワークツリーを指す重複指定は1つに畳む。文言はそのままユーザーへ出す
 */
export function resolveRemovalTargets(
  worktrees: WorktreeEntry[],
  queries: string[],
  cwd: string,
): RemovalTargetsResult {
  const targets: WorktreeEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const found = findWorktreeByQuery(worktrees, query, cwd);
    if (found.kind === "not-found") {
      errors.push(
        `ワークツリーが見つかりません: ${query}（niwaterm worktree listで一覧を確認できます）`,
      );
      continue;
    }
    if (found.kind === "ambiguous") {
      const paths = found.candidates.map((entry) => `  ${entry.path}`).join("\n");
      errors.push(
        `${query}に一致するワークツリーが複数あります。パスで指定してください:\n${paths}`,
      );
      continue;
    }
    if (found.worktree.main) {
      errors.push(`メインワークツリーは削除できません: ${found.worktree.path}`);
      continue;
    }
    if (seen.has(found.worktree.path)) continue;
    seen.add(found.worktree.path);
    targets.push(found.worktree);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, targets };
}
