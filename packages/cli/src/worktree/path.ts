// 新規ワークツリーの置き場所のテンプレート展開。
//
// 置き場所はテンプレート文字列で表し、`${repo}`（メインワークツリーのディレクトリ名）と
// `${branch}`（ブランチ名）を展開する。既定の`../${repo}@${branch}`は、メインワークツリーの
// 隣に`<repo>@<branch>`という名前で並べる形。ghq管理下でも同じ階層に並ぶので、
// リポジトリ名から関連が辿れる。
//
// 展開結果は`~/`始まり・絶対パス・メインワークツリー基準の相対パスのいずれとしても書ける。
// テンプレートをどこから読むかはworktree/config.tsが決める。

import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

export const DEFAULT_WORKTREE_DIR_TEMPLATE = "../${repo}@${branch}";

export interface WorktreePathContext {
  /** メインワークツリーのパス（絶対パス） */
  repoRoot: string;
  branch: string;
}

/**
 * ブランチ名をディレクトリ名に使える形へ直す。`/`を含むブランチ（feat/xなど）をそのまま
 * 埋めると意図しない階層ができるため、`-`へ潰す
 */
export function sanitizeBranchForPath(branch: string): string {
  return branch.replaceAll("/", "-");
}

/** `~/`始まり・絶対パス・repoRoot基準の相対パスを、いずれも絶対パスへ揃える */
function toAbsolutePath(path: string, repoRoot: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  if (isAbsolute(path)) return path;
  return resolve(repoRoot, path);
}

/** テンプレートを展開して、新規ワークツリーの絶対パスを返す */
export function expandWorktreeDirTemplate(template: string, ctx: WorktreePathContext): string {
  const expanded = template
    .replaceAll("${repo}", basename(ctx.repoRoot))
    .replaceAll("${branch}", sanitizeBranchForPath(ctx.branch));
  return toAbsolutePath(expanded, ctx.repoRoot);
}
