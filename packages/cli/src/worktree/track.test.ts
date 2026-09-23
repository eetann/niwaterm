import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isWorktreeTrackMode,
  pickDefaultRemote,
  resolveWorktreeSource,
  splitRemoteRef,
} from "./track";

const NO_GIT_CONFIG = join(tmpdir(), "niwaterm-worktree-track-test-absent-gitconfig");

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

/** ローカルにlocal-only、originにだけfeat/xがあるリポジトリを作って渡す */
async function withRepo(fn: (repo: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-track-test-"));
  try {
    const repo = join(dir, "repo");
    await git(dir, "init", "--bare", "remote.git");
    await git(dir, "init", "-b", "main", "repo");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "test");
    await git(repo, "commit", "--allow-empty", "-m", "init");
    await git(repo, "remote", "add", "origin", join(dir, "remote.git"));
    await git(repo, "push", "origin", "main");
    await git(repo, "branch", "local-only");
    await git(repo, "checkout", "-b", "feat/x");
    await git(repo, "commit", "--allow-empty", "-m", "remote only");
    await git(repo, "push", "origin", "feat/x");
    await git(repo, "checkout", "main");
    await git(repo, "branch", "-D", "feat/x");
    await git(repo, "fetch", "origin");
    await fn(repo);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("splitRemoteRef", () => {
  test("リモート名が付いていれば剥がす", () => {
    expect(splitRemoteRef("origin/feat/x", ["origin"])).toEqual({
      remote: "origin",
      branch: "feat/x",
    });
  });

  test("知らない接頭辞はブランチ名の一部として残す", () => {
    expect(splitRemoteRef("feature/origin/x", ["origin"])).toEqual({
      remote: null,
      branch: "feature/origin/x",
    });
  });

  test("リモート名に/を含む場合は長いほうから照合する", () => {
    expect(splitRemoteRef("origin/fork/feat", ["origin", "origin/fork"])).toEqual({
      remote: "origin/fork",
      branch: "feat",
    });
  });

  test("ブランチ名が残らない指定は剥がさない", () => {
    expect(splitRemoteRef("origin", ["origin"])).toEqual({ remote: null, branch: "origin" });
    expect(splitRemoteRef("origin/", ["origin"])).toEqual({ remote: null, branch: "origin/" });
  });
});

describe("pickDefaultRemote", () => {
  test("1つだけならそれを使う", () => {
    expect(pickDefaultRemote(["upstream"])).toEqual({ ok: true, remote: "upstream" });
  });

  test("複数あればoriginを選ぶ", () => {
    expect(pickDefaultRemote(["upstream", "origin"])).toEqual({ ok: true, remote: "origin" });
  });

  test("複数あってoriginが無ければ選べない", () => {
    const result = pickDefaultRemote(["upstream", "fork"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("--remote");
  });

  test("1つも無ければ選べない", () => {
    expect(pickDefaultRemote([]).ok).toBe(false);
  });
});

describe("isWorktreeTrackMode", () => {
  test("既知のモードだけを通す", () => {
    expect(isWorktreeTrackMode("auto")).toBe(true);
    expect(isWorktreeTrackMode("remote")).toBe(true);
    expect(isWorktreeTrackMode("none")).toBe(false);
    expect(isWorktreeTrackMode(undefined)).toBe(false);
  });
});

describe("resolveWorktreeSource", () => {
  test("autoは手元のブランチを最優先する", async () => {
    await withRepo(async (repo) => {
      const result = await resolveWorktreeSource({
        repoRoot: repo,
        branch: "local-only",
        mode: "auto",
        remote: "origin",
      });
      expect(result).toEqual({ ok: true, source: { kind: "local" } });
    });
  });

  test("autoはローカルに無くリモートにあればtrackする", async () => {
    await withRepo(async (repo) => {
      const result = await resolveWorktreeSource({
        repoRoot: repo,
        branch: "feat/x",
        mode: "auto",
        remote: "origin",
      });
      expect(result).toEqual({ ok: true, source: { kind: "remote", remote: "origin" } });
    });
  });

  test("autoはどちらにも無ければ新規ブランチにする", async () => {
    await withRepo(async (repo) => {
      const result = await resolveWorktreeSource({
        repoRoot: repo,
        branch: "brand-new",
        mode: "auto",
        remote: "origin",
        from: "main",
      });
      expect(result).toEqual({ ok: true, source: { kind: "new", from: "main" } });
    });
  });

  test("autoはリモートを決められなくてもローカル・新規で解決する", async () => {
    await withRepo(async (repo) => {
      expect(
        await resolveWorktreeSource({
          repoRoot: repo,
          branch: "feat/x",
          mode: "auto",
          remote: null,
        }),
      ).toEqual({ ok: true, source: { kind: "new" } });
    });
  });

  test("remoteはリモートに無ければエラー", async () => {
    await withRepo(async (repo) => {
      const result = await resolveWorktreeSource({
        repoRoot: repo,
        branch: "local-only",
        mode: "remote",
        remote: "origin",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("origin/local-only");
    });
  });

  test("remoteはリモートが無ければエラー", async () => {
    await withRepo(async (repo) => {
      const result = await resolveWorktreeSource({
        repoRoot: repo,
        branch: "feat/x",
        mode: "remote",
        remote: null,
      });
      expect(result.ok).toBe(false);
    });
  });

  test("localはローカルに無ければエラー", async () => {
    await withRepo(async (repo) => {
      const result = await resolveWorktreeSource({
        repoRoot: repo,
        branch: "feat/x",
        mode: "local",
        remote: "origin",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("feat/x");
    });
  });

  test("newはリモートに同名があっても新規ブランチにする", async () => {
    await withRepo(async (repo) => {
      expect(
        await resolveWorktreeSource({
          repoRoot: repo,
          branch: "feat/x",
          mode: "new",
          remote: "origin",
        }),
      ).toEqual({ ok: true, source: { kind: "new" } });
    });
  });

  test("newはローカルに同名があればエラー", async () => {
    await withRepo(async (repo) => {
      const result = await resolveWorktreeSource({
        repoRoot: repo,
        branch: "local-only",
        mode: "new",
        remote: "origin",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("local-only");
    });
  });
});
