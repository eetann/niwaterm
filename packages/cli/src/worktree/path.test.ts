import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WORKTREE_DIR_TEMPLATE,
  expandWorktreeDirTemplate,
  sanitizeBranchForPath,
} from "./path";

const REPO_ROOT = "/home/user/ghq/github.com/eetann/niwaterm";

describe("sanitizeBranchForPath", () => {
  test("スラッシュをハイフンへ潰す", () => {
    expect(sanitizeBranchForPath("feat/worktree")).toBe("feat-worktree");
    expect(sanitizeBranchForPath("a/b/c")).toBe("a-b-c");
  });

  test("スラッシュを含まないブランチはそのまま", () => {
    expect(sanitizeBranchForPath("dev")).toBe("dev");
  });
});

describe("expandWorktreeDirTemplate", () => {
  test("既定はメインワークツリーの隣に<repo>@<branch>で並べる", () => {
    expect(
      expandWorktreeDirTemplate(DEFAULT_WORKTREE_DIR_TEMPLATE, {
        repoRoot: REPO_ROOT,
        branch: "dev",
      }),
    ).toBe("/home/user/ghq/github.com/eetann/niwaterm@dev");
  });

  test("ブランチ名のスラッシュは階層にせずハイフンへ潰す", () => {
    expect(
      expandWorktreeDirTemplate(DEFAULT_WORKTREE_DIR_TEMPLATE, {
        repoRoot: REPO_ROOT,
        branch: "feat/worktree",
      }),
    ).toBe("/home/user/ghq/github.com/eetann/niwaterm@feat-worktree");
  });

  test("相対パスのテンプレートはメインワークツリー基準で解決する", () => {
    expect(
      expandWorktreeDirTemplate(".worktrees/${branch}", { repoRoot: REPO_ROOT, branch: "dev" }),
    ).toBe(`${REPO_ROOT}/.worktrees/dev`);
  });

  test("絶対パスのテンプレートはそのまま使う", () => {
    expect(
      expandWorktreeDirTemplate("/srv/worktrees/${repo}-${branch}", {
        repoRoot: REPO_ROOT,
        branch: "dev",
      }),
    ).toBe("/srv/worktrees/niwaterm-dev");
  });

  test("~/始まりはホームディレクトリへ展開する", () => {
    expect(
      expandWorktreeDirTemplate("~/worktrees/${repo}/${branch}", {
        repoRoot: REPO_ROOT,
        branch: "dev",
      }),
    ).toBe(join(homedir(), "worktrees", "niwaterm", "dev"));
  });

  test("同じプレースホルダーを複数回書ける", () => {
    expect(
      expandWorktreeDirTemplate("../${repo}/${repo}-${branch}", {
        repoRoot: REPO_ROOT,
        branch: "dev",
      }),
    ).toBe("/home/user/ghq/github.com/eetann/niwaterm/niwaterm-dev");
  });

  test("プレースホルダーを含まないテンプレートも使える", () => {
    expect(expandWorktreeDirTemplate("../fixed", { repoRoot: REPO_ROOT, branch: "dev" })).toBe(
      "/home/user/ghq/github.com/eetann/fixed",
    );
  });
});
