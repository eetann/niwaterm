import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addWorktree,
  branchExists,
  findWorktreeByBranch,
  gitConfigSection,
  listWorktrees,
  mainWorktree,
  parseWorktreePorcelain,
  worktreeFlags,
} from "./git";

const SAMPLE_LINES = [
  "worktree /repo/main",
  "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "branch refs/heads/main",
  "",
  "worktree /repo/detached",
  "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "detached",
  "",
].join("\n");

describe("parseWorktreePorcelain", () => {
  test("行区切りのporcelainからpath/branch/HEADを取る", () => {
    const entries = parseWorktreePorcelain(SAMPLE_LINES, "\n");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      path: "/repo/main",
      branch: "main",
      head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      detached: false,
      main: true,
    });
    expect(entries[1]).toMatchObject({
      path: "/repo/detached",
      branch: null,
      detached: true,
      main: false,
    });
  });

  test("先頭レコードだけをメインワークツリーとして扱う", () => {
    const entries = parseWorktreePorcelain(SAMPLE_LINES, "\n");
    expect(entries.filter((entry) => entry.main)).toHaveLength(1);
    expect(mainWorktree(entries)?.path).toBe("/repo/main");
  });

  test("locked・prunableを理由付き・理由無しの両方で拾う", () => {
    const output = [
      "worktree /repo/main",
      "HEAD aaaa",
      "branch refs/heads/main",
      "",
      "worktree /repo/locked",
      "HEAD bbbb",
      "branch refs/heads/wip",
      "locked",
      "",
      "worktree /repo/prunable",
      "HEAD cccc",
      "detached",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    const entries = parseWorktreePorcelain(output, "\n");
    expect(entries[1]).toMatchObject({ locked: true, lockedReason: null });
    expect(entries[2]).toMatchObject({
      prunable: true,
      prunableReason: "gitdir file points to non-existent location",
    });
  });

  test("bareリポジトリはbranch・HEADを持たない", () => {
    const entries = parseWorktreePorcelain("worktree /repo/bare\nbare\n\n", "\n");
    expect(entries[0]).toMatchObject({ path: "/repo/bare", bare: true, branch: null, head: null });
  });

  test("refs/heads/以外のrefはそのまま残す", () => {
    const output = "worktree /repo/x\nHEAD aaaa\nbranch refs/remotes/origin/main\n\n";
    expect(parseWorktreePorcelain(output, "\n")[0]?.branch).toBe("refs/remotes/origin/main");
  });

  test("-zのNUL区切りでも同じ結果になる", () => {
    const zOutput = SAMPLE_LINES.replaceAll("\n", "\0");
    expect(parseWorktreePorcelain(zOutput, "\0")).toEqual(
      parseWorktreePorcelain(SAMPLE_LINES, "\n"),
    );
  });

  test("-zならパスに改行を含むワークツリーも1レコードとして読める", () => {
    const zOutput = "worktree /repo/we\nird\0HEAD aaaa\0branch refs/heads/main\0\0";
    const entries = parseWorktreePorcelain(zOutput, "\0");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("/repo/we\nird");
  });

  test("末尾の空レコード区切りが無くても最後のレコードを落とさない", () => {
    const output = "worktree /repo/main\nHEAD aaaa\nbranch refs/heads/main";
    expect(parseWorktreePorcelain(output, "\n")).toHaveLength(1);
  });

  test("行区切りのCRLFを混入させない", () => {
    const output = "worktree /repo/main\r\nHEAD aaaa\r\nbranch refs/heads/main\r\n\r\n";
    expect(parseWorktreePorcelain(output, "\n")[0]).toMatchObject({
      path: "/repo/main",
      branch: "main",
      head: "aaaa",
    });
  });

  test("空文字列ではレコードを作らない", () => {
    expect(parseWorktreePorcelain("", "\n")).toEqual([]);
  });
});

describe("worktreeFlags", () => {
  test("該当するフラグだけを並べる", () => {
    const entries = parseWorktreePorcelain(SAMPLE_LINES, "\n");
    expect(worktreeFlags(entries[0])).toEqual(["main"]);
    expect(worktreeFlags(entries[1])).toEqual(["detached"]);
  });
});

const NO_GIT_CONFIG = join(tmpdir(), "niwaterm-worktree-test-absent-gitconfig");

/** テスト用のgitコマンド実行。失敗したら例外にする */
async function git(cwd: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    // ユーザーのグローバル設定（署名の強制・hooksPath等）でテスト用リポジトリの操作が
    // 失敗しないよう、存在しないパスを指して空の設定として扱わせる
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
      GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
    },
  });
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
}

describe("listWorktrees", () => {
  test("実際のリポジトリでメインとリンクされたワークツリーを列挙する", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-test-"));
    try {
      const repo = join(dir, "repo");
      await git(dir, "init", "-b", "main", "repo");
      await git(repo, "config", "user.email", "test@example.com");
      await git(repo, "config", "user.name", "test");
      await git(repo, "commit", "--allow-empty", "-m", "init");
      await git(repo, "worktree", "add", "-b", "feature", join(dir, "repo@feature"));

      const result = await listWorktrees(repo);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.worktrees).toHaveLength(2);
      expect(result.worktrees[0]).toMatchObject({ branch: "main", main: true });
      expect(result.worktrees[1]).toMatchObject({ branch: "feature", main: false });
      expect(result.worktrees[0]?.head).toMatch(/^[0-9a-f]{40}$/);

      // リンクされたワークツリー側から引いてもメインが先頭に来る
      const fromLinked = await listWorktrees(join(dir, "repo@feature"));
      expect(fromLinked.ok).toBe(true);
      if (!fromLinked.ok) return;
      expect(mainWorktree(fromLinked.worktrees)?.branch).toBe("main");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("gitリポジトリ外はnot-a-repositoryを返す", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-test-"));
    try {
      const result = await listWorktrees(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("not-a-repository");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("存在しないディレクトリはinvalid-cwdを返す", async () => {
    const result = await listWorktrees(join(tmpdir(), "niwaterm-worktree-does-not-exist"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid-cwd");
  });
});

describe("addWorktree", () => {
  /** commit済みのリポジトリを1つ作って渡す */
  async function withRepo(fn: (dir: string, repo: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-add-test-"));
    try {
      const repo = join(dir, "repo");
      await git(dir, "init", "-b", "main", "repo");
      await git(repo, "config", "user.email", "test@example.com");
      await git(repo, "config", "user.name", "test");
      await git(repo, "commit", "--allow-empty", "-m", "init");
      await fn(dir, repo);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("未作成のブランチはワークツリーと同時に作る", async () => {
    await withRepo(async (dir, repo) => {
      const path = join(dir, "repo@feature");
      expect(await addWorktree({ repoRoot: repo, path, branch: "feature" })).toEqual({ ok: true });
      const result = await listWorktrees(repo);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(findWorktreeByBranch(result.worktrees, "feature")?.path).toBe(path);
    });
  });

  test("既存ブランチはそのままチェックアウトする", async () => {
    await withRepo(async (dir, repo) => {
      await git(repo, "branch", "existing");
      expect(await branchExists("existing", repo)).toBe(true);
      const path = join(dir, "repo@existing");
      expect(await addWorktree({ repoRoot: repo, path, branch: "existing" })).toEqual({ ok: true });
      const result = await listWorktrees(repo);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(findWorktreeByBranch(result.worktrees, "existing")?.path).toBe(path);
    });
  });

  test("fromで分岐元を指定できる", async () => {
    await withRepo(async (dir, repo) => {
      await git(repo, "branch", "base");
      await git(repo, "commit", "--allow-empty", "-m", "second");
      const path = join(dir, "repo@derived");
      expect(await addWorktree({ repoRoot: repo, path, branch: "derived", from: "base" })).toEqual({
        ok: true,
      });
      const result = await listWorktrees(repo);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const base = findWorktreeByBranch(result.worktrees, "main");
      const derived = findWorktreeByBranch(result.worktrees, "derived");
      // baseから分岐しているので、2つ目のcommitを持つmainとはHEADが違う
      expect(derived?.head).not.toBe(base?.head);
    });
  });

  test("既にチェックアウト済みのブランチはgitのエラーを返す", async () => {
    await withRepo(async (dir, repo) => {
      const result = await addWorktree({ repoRoot: repo, path: join(dir, "dup"), branch: "main" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("main");
    });
  });

  test("未作成のブランチではbranchExistsがfalse", async () => {
    await withRepo(async (_dir, repo) => {
      expect(await branchExists("nope", repo)).toBe(false);
    });
  });
});

describe("gitConfigSection", () => {
  test("prefix配下のキーだけをprefixを除いて返す", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-gitconfig-test-"));
    try {
      await git(dir, "init", "-b", "main");
      await git(dir, "config", "niwaterm.worktree.dir", ".worktrees/${branch}");
      await git(dir, "config", "niwaterm.worktree.open", "board-switch");
      await git(dir, "config", "niwaterm.other.key", "ignored");
      const values = await gitConfigSection("niwaterm.worktree", dir);
      expect(values.get("dir")).toBe(".worktrees/${branch}");
      expect(values.get("open")).toBe("board-switch");
      expect(values.has("key")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("値に空白が入っても壊れない", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-gitconfig-test-"));
    try {
      await git(dir, "init", "-b", "main");
      await git(dir, "config", "niwaterm.worktree.dir", "../with space/${branch}");
      expect((await gitConfigSection("niwaterm.worktree", dir)).get("dir")).toBe(
        "../with space/${branch}",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("設定が1件も無ければ空のMap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-gitconfig-test-"));
    try {
      await git(dir, "init", "-b", "main");
      expect((await gitConfigSection("niwaterm.worktree", dir)).size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
