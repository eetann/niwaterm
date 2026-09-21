import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  countUncommittedChanges,
  countUnpushedCommits,
  deleteBranch,
  hasRemotes,
  listWorktrees,
  removeWorktree,
  type WorktreeEntry,
} from "./git";
import { inspectWorktree, isInsideWorktree, NO_REMOTE, removalBlockers, UNKNOWN } from "./remove";

const NO_GIT_CONFIG = join(tmpdir(), "niwaterm-worktree-remove-test-absent-gitconfig");

/** テスト用のgitコマンド実行。失敗したら例外にする */
async function git(cwd: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    env: { ...process.env, GIT_CONFIG_GLOBAL: NO_GIT_CONFIG, GIT_CONFIG_SYSTEM: NO_GIT_CONFIG },
  });
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
}

/** commit 1つとfeatureワークツリーを持つリポジトリを用意する */
async function withRepo(
  fn: (ctx: { dir: string; repo: string; worktree: string }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-remove-test-"));
  try {
    const repo = join(dir, "repo");
    const worktree = join(dir, "repo@feature");
    await git(dir, "init", "-b", "main", "repo");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "test");
    await git(repo, "commit", "--allow-empty", "-m", "init");
    await git(repo, "worktree", "add", "-b", "feature", worktree);
    await fn({ dir, repo, worktree });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 一覧から指定パスのエントリを引く。見つからなければ例外 */
async function entryAt(repo: string, path: string): Promise<WorktreeEntry> {
  const list = await listWorktrees(repo);
  if (!list.ok) throw new Error(list.error);
  const entry = list.worktrees.find((candidate) => candidate.path === path);
  if (!entry) throw new Error(`worktree not found: ${path}`);
  return entry;
}

const CLEAN: Parameters<typeof removalBlockers>[0] = {
  uncommitted: 0,
  unpushed: 0,
  locked: false,
  lockedReason: null,
  prunable: false,
};

describe("removalBlockers", () => {
  test("何も無ければ削除してよい", () => {
    expect(removalBlockers(CLEAN)).toEqual([]);
    expect(removalBlockers({ ...CLEAN, unpushed: NO_REMOTE })).toEqual([]);
  });

  test("未コミットの変更・未pushのコミット・ロックをそれぞれ理由に挙げる", () => {
    const blockers = removalBlockers({
      ...CLEAN,
      uncommitted: 3,
      unpushed: 2,
      locked: true,
      lockedReason: "wip",
    });
    expect(blockers).toHaveLength(3);
    expect(blockers[0]).toContain("3件");
    expect(blockers[1]).toContain("2件");
    expect(blockers[2]).toContain("wip");
  });

  test("理由の無いロックも止める", () => {
    expect(removalBlockers({ ...CLEAN, locked: true })).toEqual([
      "ワークツリーがロックされています",
    ]);
  });

  test("判定できなかった観点は安全側に倒して止める", () => {
    expect(removalBlockers({ ...CLEAN, uncommitted: UNKNOWN })).toHaveLength(1);
    expect(removalBlockers({ ...CLEAN, unpushed: UNKNOWN })).toHaveLength(1);
  });

  test("実体ディレクトリが無いワークツリーは未コミットの変更を問わない", () => {
    expect(removalBlockers({ ...CLEAN, uncommitted: UNKNOWN, prunable: true })).toEqual([]);
  });
});

describe("isInsideWorktree", () => {
  test("ワークツリー自身とその配下だけを中と見なす", () => {
    const base = join(sep, "repo", "wt");
    expect(isInsideWorktree(base, base)).toBe(true);
    expect(isInsideWorktree(base, join(base, "src"))).toBe(true);
    expect(isInsideWorktree(base, join(sep, "repo"))).toBe(false);
  });

  test("名前が前方一致するだけの兄弟ディレクトリは中ではない", () => {
    expect(isInsideWorktree(join(sep, "repo", "wt"), join(sep, "repo", "wt2"))).toBe(false);
  });
});

describe("countUncommittedChanges", () => {
  test("追跡ファイルの変更と未追跡ファイルの両方を数える", async () => {
    await withRepo(async ({ worktree }) => {
      expect(await countUncommittedChanges(worktree)).toBe(0);
      await writeFile(join(worktree, "tracked.txt"), "a");
      await git(worktree, "add", "tracked.txt");
      await git(worktree, "commit", "-m", "add tracked");
      await writeFile(join(worktree, "tracked.txt"), "b");
      await writeFile(join(worktree, "untracked.txt"), "c");
      expect(await countUncommittedChanges(worktree)).toBe(2);
    });
  });

  test("ディレクトリが無ければnull", async () => {
    expect(await countUncommittedChanges(join(tmpdir(), "niwaterm-worktree-does-not-exist"))).toBe(
      null,
    );
  });
});

describe("countUnpushedCommits", () => {
  test("リモート追跡ブランチに無いコミットだけを数える", async () => {
    await withRepo(async ({ repo, worktree }) => {
      // pushの代わりにリモート追跡refを直に作る（テストでネットワーク・bareリポジトリを使わないため）
      await git(repo, "remote", "add", "origin", "/dev/null");
      await git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
      const head = (await entryAt(repo, worktree)).head ?? "";
      expect(await countUnpushedCommits(repo, head)).toBe(0);

      await git(worktree, "commit", "--allow-empty", "-m", "local only");
      const next = (await entryAt(repo, worktree)).head ?? "";
      expect(await countUnpushedCommits(repo, next)).toBe(1);
    });
  });
});

describe("inspectWorktree", () => {
  test("リモートが無いリポジトリでは未pushを判定しない", async () => {
    await withRepo(async ({ repo, worktree }) => {
      expect(await hasRemotes(repo)).toBe(false);
      const state = await inspectWorktree(repo, await entryAt(repo, worktree));
      expect(state.unpushed).toBe(NO_REMOTE);
      expect(removalBlockers(state)).toEqual([]);
    });
  });

  test("未コミットの変更があれば削除を止める", async () => {
    await withRepo(async ({ repo, worktree }) => {
      await writeFile(join(worktree, "untracked.txt"), "a");
      const state = await inspectWorktree(repo, await entryAt(repo, worktree));
      expect(state.uncommitted).toBe(1);
      expect(removalBlockers(state)).toHaveLength(1);
    });
  });

  test("ロックされたワークツリーは理由付きで止める", async () => {
    await withRepo(async ({ repo, worktree }) => {
      await git(repo, "worktree", "lock", "--reason", "wip", worktree);
      const state = await inspectWorktree(repo, await entryAt(repo, worktree));
      expect(removalBlockers(state)).toEqual(["ワークツリーがロックされています: wip"]);
    });
  });
});

describe("removeWorktree", () => {
  test("ワークツリーを消すとgitの一覧からも消える", async () => {
    await withRepo(async ({ repo, worktree }) => {
      expect(await removeWorktree({ repoRoot: repo, path: worktree, force: false })).toEqual({
        ok: true,
      });
      const list = await listWorktrees(repo);
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      expect(list.worktrees).toHaveLength(1);
    });
  });

  test("未コミットの変更があるとforce無しでは失敗する", async () => {
    await withRepo(async ({ repo, worktree }) => {
      await writeFile(join(worktree, "untracked.txt"), "a");
      const failed = await removeWorktree({ repoRoot: repo, path: worktree, force: false });
      expect(failed.ok).toBe(false);
      expect(await removeWorktree({ repoRoot: repo, path: worktree, force: true })).toEqual({
        ok: true,
      });
    });
  });

  test("ロックされていてもforceなら消える", async () => {
    await withRepo(async ({ repo, worktree }) => {
      await git(repo, "worktree", "lock", "--reason", "wip", worktree);
      expect(await removeWorktree({ repoRoot: repo, path: worktree, force: true })).toEqual({
        ok: true,
      });
    });
  });

  test("メインワークツリーは消せない", async () => {
    await withRepo(async ({ repo }) => {
      const result = await removeWorktree({ repoRoot: repo, path: repo, force: true });
      expect(result.ok).toBe(false);
    });
  });
});

describe("deleteBranch", () => {
  test("マージ済みのブランチはforce無しで消せる", async () => {
    await withRepo(async ({ repo, worktree }) => {
      await removeWorktree({ repoRoot: repo, path: worktree, force: false });
      expect(await deleteBranch({ repoRoot: repo, branch: "feature", force: false })).toEqual({
        ok: true,
      });
    });
  });

  test("未マージのブランチはforceが要る", async () => {
    await withRepo(async ({ repo, worktree }) => {
      await git(worktree, "commit", "--allow-empty", "-m", "unmerged");
      await removeWorktree({ repoRoot: repo, path: worktree, force: false });
      const failed = await deleteBranch({ repoRoot: repo, branch: "feature", force: false });
      expect(failed.ok).toBe(false);
      expect(await deleteBranch({ repoRoot: repo, branch: "feature", force: true })).toEqual({
        ok: true,
      });
    });
  });

  test("ワークツリーが残っているブランチは消せない", async () => {
    await withRepo(async ({ repo }) => {
      const result = await deleteBranch({ repoRoot: repo, branch: "feature", force: true });
      expect(result.ok).toBe(false);
    });
  });
});
