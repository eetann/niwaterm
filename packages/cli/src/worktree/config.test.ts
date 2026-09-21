import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WORKTREE_OPEN_MODE,
  isWorktreeOpenMode,
  pickWorktreeSettings,
  readWorktreeSettingsFromFile,
  resolveWorktreeSettings,
  type WorktreeDirSources,
  worktreeDirSourcesFor,
} from "./config";
import { DEFAULT_WORKTREE_DIR_TEMPLATE } from "./path";

describe("pickWorktreeSettings", () => {
  test("worktree.dir・worktree.openを取り出す", () => {
    expect(
      pickWorktreeSettings({ worktree: { dir: ".worktrees/${branch}", open: "board-switch" } }),
    ).toEqual({ dir: ".worktrees/${branch}", open: "board-switch" });
  });

  test("worktree以外のキーには反応しない", () => {
    expect(pickWorktreeSettings({ layouts: { dev: {} } })).toEqual({});
  });

  test("形が違う値は項目ごとに落とす", () => {
    expect(pickWorktreeSettings(null)).toEqual({});
    expect(pickWorktreeSettings("string")).toEqual({});
    expect(pickWorktreeSettings({ worktree: null })).toEqual({});
    expect(pickWorktreeSettings({ worktree: { dir: 42 } })).toEqual({});
    // 空文字列は「未設定」と区別できないので採らない
    expect(pickWorktreeSettings({ worktree: { dir: "" } })).toEqual({});
    // 未知のopenは落とし、正しいdirだけ残す
    expect(pickWorktreeSettings({ worktree: { dir: "../wt", open: "somewhere" } })).toEqual({
      dir: "../wt",
    });
  });
});

describe("isWorktreeOpenMode", () => {
  test("既知のモードだけ通す", () => {
    expect(isWorktreeOpenMode("board")).toBe(true);
    expect(isWorktreeOpenMode("board-switch")).toBe(true);
    expect(isWorktreeOpenMode("current-tab")).toBe(true);
    expect(isWorktreeOpenMode("none")).toBe(true);
    expect(isWorktreeOpenMode("board-bg")).toBe(false);
    expect(isWorktreeOpenMode(undefined)).toBe(false);
  });
});

/** 一時ディレクトリへ設定ファイルを書く */
async function writeConfig(path: string, body: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await Bun.write(path, body);
}

describe("readWorktreeSettingsFromFile", () => {
  test("default exportのworktreeセクションを読む", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-config-test-"));
    try {
      const path = join(dir, "config.ts");
      await writeConfig(path, 'export default { worktree: { dir: "../wt/${branch}" } };\n');
      expect(await readWorktreeSettingsFromFile(path)).toEqual({ dir: "../wt/${branch}" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ファイルが無ければ空", async () => {
    expect(await readWorktreeSettingsFromFile(join(tmpdir(), "niwaterm-absent.ts"))).toEqual({});
  });

  test("importで落ちる設定ファイルは空（次の候補へ譲る）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-config-test-"));
    try {
      const path = join(dir, "config.ts");
      await writeConfig(path, "throw new Error('broken');\n");
      expect(await readWorktreeSettingsFromFile(path)).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** git configだけを持つテスト用リポジトリを作る */
async function initRepo(dir: string, config: Record<string, string> = {}): Promise<void> {
  const run = async (...args: string[]): Promise<void> => {
    const proc = Bun.spawn(["git", ...args], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    const stderr = await new Response(proc.stderr).text();
    if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
  };
  await run("init", "-b", "main");
  for (const [key, value] of Object.entries(config)) await run("config", key, value);
}

describe("resolveWorktreeSettings", () => {
  /** 各tierの有無を組み合わせてテストできるよう、探索先を一時ディレクトリへ向ける */
  async function sourcesIn(
    root: string,
    files: { project?: string; global?: string },
  ): Promise<WorktreeDirSources> {
    const projectConfigPath = join(root, "project", ".niwaterm", "config.ts");
    const globalConfigPath = join(root, "global", "niwaterm.config.ts");
    if (files.project !== undefined) await writeConfig(projectConfigPath, files.project);
    if (files.global !== undefined) await writeConfig(globalConfigPath, files.global);
    return { projectConfigPath, globalConfigPath, gitCwd: join(root, "repo") };
  }

  async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-resolve-test-"));
    try {
      await mkdir(join(dir, "repo"), { recursive: true });
      await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("どこにも無ければ既定値", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"));
      expect(await resolveWorktreeSettings(await sourcesIn(root, {}))).toEqual({
        dir: { value: DEFAULT_WORKTREE_DIR_TEMPLATE, source: "default" },
        open: { value: DEFAULT_WORKTREE_OPEN_MODE, source: "default" },
      });
    });
  });

  test("git configだけあればそれを使う", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"), {
        "niwaterm.worktree.dir": "../from-git/${branch}",
        "niwaterm.worktree.open": "current-tab",
      });
      expect(await resolveWorktreeSettings(await sourcesIn(root, {}))).toEqual({
        dir: { value: "../from-git/${branch}", source: "git-config" },
        open: { value: "current-tab", source: "git-config" },
      });
    });
  });

  test("グローバル設定はgit configより優先される", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"), { "niwaterm.worktree.dir": "../from-git/${branch}" });
      const sources = await sourcesIn(root, {
        global: 'export default { worktree: { dir: "../from-global/${branch}" } };\n',
      });
      expect((await resolveWorktreeSettings(sources)).dir).toEqual({
        value: "../from-global/${branch}",
        source: "global",
      });
    });
  });

  test("プロジェクトローカル設定が最優先", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"), { "niwaterm.worktree.dir": "../from-git/${branch}" });
      const sources = await sourcesIn(root, {
        project: 'export default { worktree: { dir: "../from-project/${branch}" } };\n',
        global: 'export default { worktree: { dir: "../from-global/${branch}" } };\n',
      });
      expect((await resolveWorktreeSettings(sources)).dir).toEqual({
        value: "../from-project/${branch}",
        source: "project",
      });
    });
  });

  test("項目ごとに独立して解決する", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"), { "niwaterm.worktree.open": "none" });
      const sources = await sourcesIn(root, {
        global: 'export default { worktree: { dir: "../from-global/${branch}" } };\n',
      });
      // dirはグローバル設定、openはgit configと、別のtierから採れる
      expect(await resolveWorktreeSettings(sources)).toEqual({
        dir: { value: "../from-global/${branch}", source: "global" },
        open: { value: "none", source: "git-config" },
      });
    });
  });

  test("git configの未知のopenは無視して既定値へ落とす", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"), { "niwaterm.worktree.open": "somewhere" });
      expect((await resolveWorktreeSettings(await sourcesIn(root, {}))).open).toEqual({
        value: DEFAULT_WORKTREE_OPEN_MODE,
        source: "default",
      });
    });
  });

  test("worktreeを持たない設定ファイルは無いのと同じに扱う", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"), { "niwaterm.worktree.dir": "../from-git/${branch}" });
      const sources = await sourcesIn(root, { project: "export default { layouts: {} };\n" });
      expect((await resolveWorktreeSettings(sources)).dir.source).toBe("git-config");
    });
  });
});

describe("worktreeDirSourcesFor", () => {
  test("メインワークツリー直下の.niwaterm/config.tsを見る", () => {
    const sources = worktreeDirSourcesFor("/repo/main");
    expect(sources.projectConfigPath).toBe(join("/repo/main", ".niwaterm", "config.ts"));
    expect(sources.gitCwd).toBe("/repo/main");
  });
});
