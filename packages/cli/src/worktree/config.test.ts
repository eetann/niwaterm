import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pickWorktreeDir,
  readWorktreeDirFromFile,
  resolveWorktreeDirTemplate,
  type WorktreeDirSources,
  worktreeDirSourcesFor,
} from "./config";
import { DEFAULT_WORKTREE_DIR_TEMPLATE } from "./path";

describe("pickWorktreeDir", () => {
  test("worktree.dirの文字列を取り出す", () => {
    expect(pickWorktreeDir({ worktree: { dir: ".worktrees/${branch}" } })).toBe(
      ".worktrees/${branch}",
    );
  });

  test("worktree以外のキーには反応しない", () => {
    expect(pickWorktreeDir({ layouts: { dev: {} } })).toBeNull();
  });

  test("形が違う値はnull", () => {
    expect(pickWorktreeDir(null)).toBeNull();
    expect(pickWorktreeDir("string")).toBeNull();
    expect(pickWorktreeDir({ worktree: null })).toBeNull();
    expect(pickWorktreeDir({ worktree: { dir: 42 } })).toBeNull();
    // 空文字列は「未設定」と区別できないので採らない
    expect(pickWorktreeDir({ worktree: { dir: "" } })).toBeNull();
  });
});

/** 一時ディレクトリへ設定ファイルを書く */
async function writeConfig(path: string, body: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await Bun.write(path, body);
}

describe("readWorktreeDirFromFile", () => {
  test("default exportのworktree.dirを読む", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-config-test-"));
    try {
      const path = join(dir, "config.ts");
      await writeConfig(path, 'export default { worktree: { dir: "../wt/${branch}" } };\n');
      expect(await readWorktreeDirFromFile(path)).toBe("../wt/${branch}");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ファイルが無ければnull", async () => {
    expect(await readWorktreeDirFromFile(join(tmpdir(), "niwaterm-absent-config.ts"))).toBeNull();
  });

  test("importで落ちる設定ファイルはnull（次の候補へ譲る）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-config-test-"));
    try {
      const path = join(dir, "config.ts");
      await writeConfig(path, "throw new Error('broken');\n");
      expect(await readWorktreeDirFromFile(path)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** git configだけを持つテスト用リポジトリを作る */
async function initRepo(dir: string, worktreeDir?: string): Promise<void> {
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
  if (worktreeDir !== undefined) await run("config", "niwaterm.worktree.dir", worktreeDir);
}

describe("resolveWorktreeDirTemplate", () => {
  let dir: string;

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
    dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-resolve-test-"));
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
      expect(await resolveWorktreeDirTemplate(await sourcesIn(root, {}))).toEqual({
        template: DEFAULT_WORKTREE_DIR_TEMPLATE,
        source: "default",
      });
    });
  });

  test("git configだけあればそれを使う", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"), "../from-git/${branch}");
      expect(await resolveWorktreeDirTemplate(await sourcesIn(root, {}))).toEqual({
        template: "../from-git/${branch}",
        source: "git-config",
      });
    });
  });

  test("グローバル設定はgit configより優先される", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"), "../from-git/${branch}");
      const sources = await sourcesIn(root, {
        global: 'export default { worktree: { dir: "../from-global/${branch}" } };\n',
      });
      expect(await resolveWorktreeDirTemplate(sources)).toEqual({
        template: "../from-global/${branch}",
        source: "global",
      });
    });
  });

  test("プロジェクトローカル設定が最優先", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"), "../from-git/${branch}");
      const sources = await sourcesIn(root, {
        project: 'export default { worktree: { dir: "../from-project/${branch}" } };\n',
        global: 'export default { worktree: { dir: "../from-global/${branch}" } };\n',
      });
      expect(await resolveWorktreeDirTemplate(sources)).toEqual({
        template: "../from-project/${branch}",
        source: "project",
      });
    });
  });

  test("worktreeを持たない設定ファイルは無いのと同じに扱う", async () => {
    await withTempDir(async (root) => {
      await initRepo(join(root, "repo"), "../from-git/${branch}");
      const sources = await sourcesIn(root, {
        project: "export default { layouts: {} };\n",
      });
      expect((await resolveWorktreeDirTemplate(sources)).source).toBe("git-config");
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
