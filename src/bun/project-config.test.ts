import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LayoutsConfig } from "@niwaterm/config";
import { BUILTIN_LAYOUT_DESCRIPTIONS } from "./builtin-layouts";
import {
  listResolvedLayouts,
  loadProjectLayouts,
  loadProjectPreset,
  projectConfigFilePath,
  resolveLayoutPresetByName,
  resolveProjectRoot,
  resolveTabCwd,
} from "./project-config";

let root: string;

beforeEach(async () => {
  // macOSのtmpdir()は/var -> /private/varのシンボリックリンクを含む。gitはワークツリーの
  // パスをシンボリックリンクを解決した実体側で記録するため、起点を実体パスに揃えないと
  // resolveProjectRootの戻り値と文字列比較できない
  root = await realpath(await mkdtemp(join(tmpdir(), "niwaterm-project-config-test-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** <dir>/.niwaterm/config.ts を作る。sourceはそのままファイル内容として書き込む */
async function writeProjectConfig(dir: string, source: string): Promise<void> {
  await mkdir(join(dir, ".niwaterm"), { recursive: true });
  await writeFile(projectConfigFilePath(dir), source);
}

const DEV_PRESET_SOURCE = `export default {
  layouts: {
    dev: {
      description: "project dev",
      layout: { kind: "tile", tabs: [{ name: "editor" }] },
    },
  },
};
`;

async function git(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

describe("resolveProjectRoot", () => {
  test(".niwaterm/を持つディレクトリ自身をルートとして返す", async () => {
    await writeProjectConfig(root, DEV_PRESET_SOURCE);
    expect(await resolveProjectRoot(root)).toBe(root);
  });

  test("サブディレクトリからは上向きに探して最も近いルートを返す", async () => {
    await writeProjectConfig(root, DEV_PRESET_SOURCE);
    const nested = join(root, "packages", "cli");
    await mkdir(nested, { recursive: true });
    expect(await resolveProjectRoot(nested)).toBe(root);
  });

  test("入れ子の.niwaterm/があれば近い方が優先される", async () => {
    await writeProjectConfig(root, DEV_PRESET_SOURCE);
    const inner = join(root, "packages", "cli");
    await writeProjectConfig(inner, DEV_PRESET_SOURCE);
    expect(await resolveProjectRoot(join(inner, "src"))).toBe(inner);
  });

  test(".niwaterm/が無ければnull", async () => {
    expect(await resolveProjectRoot(root)).toBeNull();
  });

  test("cwd未指定ならnull（起動時など、解決の起点が無いケース）", async () => {
    expect(await resolveProjectRoot(undefined)).toBeNull();
  });

  test("リンクされたワークツリーからはメインツリー側の.niwaterm/も見る", async () => {
    const main = join(root, "main");
    await mkdir(main, { recursive: true });
    await git(main, ["init", "-q", "-b", "main"]);
    await git(main, ["config", "user.email", "test@example.com"]);
    await git(main, ["config", "user.name", "test"]);
    await writeProjectConfig(main, DEV_PRESET_SOURCE);
    await writeFile(join(main, "README.md"), "hello");
    await git(main, ["add", "-A"]);
    await git(main, ["commit", "-qm", "init"]);

    // ワークツリー側には.niwaterm/をコミットしていない状況を作る（.gitignoreしている等）
    const linked = join(root, "wt");
    await git(main, ["worktree", "add", "-q", "-b", "dev", linked]);
    await rm(join(linked, ".niwaterm"), { recursive: true, force: true });

    expect(await resolveProjectRoot(linked)).toBe(main);
  });
});

describe("loadProjectLayouts", () => {
  test(".niwaterm/config.tsのlayoutsを読む", async () => {
    await writeProjectConfig(root, DEV_PRESET_SOURCE);
    const layouts = await loadProjectLayouts(root);
    expect(Object.keys(layouts)).toEqual(["dev"]);
    expect(layouts["dev"]?.description).toBe("project dev");
  });

  test("ファイルが無ければ空", async () => {
    expect(await loadProjectLayouts(root)).toEqual({});
  });

  test("layoutフィールドを持たないプリセットは警告付きでスキップする", async () => {
    await writeProjectConfig(
      root,
      `export default { layouts: { ok: { layout: { kind: "tile", tabs: [{}] } }, broken: {} } };`,
    );
    expect(Object.keys(await loadProjectLayouts(root))).toEqual(["ok"]);
  });

  test("構文エラーでも例外を投げず空を返す", async () => {
    await writeProjectConfig(root, `export default { layouts: {`);
    expect(await loadProjectLayouts(root)).toEqual({});
  });

  test("NiwatermProjectConfigの形をしていなければ空を返す", async () => {
    await writeProjectConfig(root, `export default { layouts: "nope" };`);
    expect(await loadProjectLayouts(root)).toEqual({});
  });
});

describe("resolveLayoutPresetByName", () => {
  const GLOBAL: LayoutsConfig = {
    dev: { description: "global dev", layout: { kind: "tile", tabs: [{ name: "global" }] } },
    onlyGlobal: { layout: { kind: "tile", tabs: [{}] } },
  };

  test("同名プリセットはプロジェクト側が勝つ", async () => {
    await writeProjectConfig(root, DEV_PRESET_SOURCE);
    const resolved = await resolveLayoutPresetByName("dev", root, GLOBAL);
    expect(resolved?.projectRoot).toBe(root);
    expect(resolved?.preset.description).toBe("project dev");
  });

  test("プロジェクトに無ければグローバルへフォールバックし、projectRootはnullになる", async () => {
    await writeProjectConfig(root, DEV_PRESET_SOURCE);
    const resolved = await resolveLayoutPresetByName("onlyGlobal", root, GLOBAL);
    expect(resolved?.projectRoot).toBeNull();
  });

  test(".niwaterm/が無ければグローバルのみで解決する", async () => {
    const resolved = await resolveLayoutPresetByName("dev", root, GLOBAL);
    expect(resolved?.projectRoot).toBeNull();
    expect(resolved?.preset.description).toBe("global dev");
  });

  test("どちらにも無ければnull", async () => {
    expect(await resolveLayoutPresetByName("missing", root, GLOBAL)).toBeNull();
  });

  test("設定に無いビルトイン名はビルトインとして解決される", async () => {
    expect(await resolveLayoutPresetByName("empty", root, GLOBAL)).toEqual({
      kind: "builtin",
      name: "empty",
      projectRoot: null,
    });
  });

  test("同名のユーザー定義プリセットがあればビルトインは隠れる", async () => {
    const shadowed: LayoutsConfig = { empty: { layout: { kind: "tile", tabs: [{}] } } };
    const resolved = await resolveLayoutPresetByName("empty", root, shadowed);
    expect(resolved?.kind).toBe("config");
  });
});

describe("listResolvedLayouts", () => {
  const GLOBAL: LayoutsConfig = {
    dev: { description: "global dev", layout: { kind: "tile", tabs: [{}] } },
    zzz: { layout: { kind: "tile", tabs: [{}] } },
  };

  const BUILTIN_EMPTY = {
    name: "empty",
    description: BUILTIN_LAYOUT_DESCRIPTIONS.empty,
    projectRoot: null,
    builtin: true,
  };

  test("プロジェクト→グローバル→ビルトインの順に並び、同名はプロジェクト側だけを返す", async () => {
    await writeProjectConfig(root, DEV_PRESET_SOURCE);
    expect(await listResolvedLayouts(root, GLOBAL)).toEqual([
      { name: "dev", description: "project dev", projectRoot: root },
      { name: "zzz", projectRoot: null },
      BUILTIN_EMPTY,
    ]);
  });

  test(".niwaterm/が無ければグローバルとビルトインのみ", async () => {
    expect(await listResolvedLayouts(root, GLOBAL)).toEqual([
      { name: "dev", description: "global dev", projectRoot: null },
      { name: "zzz", projectRoot: null },
      BUILTIN_EMPTY,
    ]);
  });

  test("ビルトインと同名のユーザー定義プリセットがあれば、ビルトイン側は出さない", async () => {
    const shadowed: LayoutsConfig = {
      empty: { description: "user empty", layout: { kind: "tile", tabs: [{}] } },
    };
    expect(await listResolvedLayouts(root, shadowed)).toEqual([
      { name: "empty", description: "user empty", projectRoot: null },
    ]);
  });
});

describe("loadProjectPreset", () => {
  test("永続化済みのprojectRootから直接プリセットを引く（起動時用）", async () => {
    await writeProjectConfig(root, DEV_PRESET_SOURCE);
    expect((await loadProjectPreset(root, "dev"))?.description).toBe("project dev");
    expect(await loadProjectPreset(root, "missing")).toBeNull();
  });
});

describe("resolveTabCwd", () => {
  test("cwd未指定ならbaseそのもの", () => {
    expect(resolveTabCwd(undefined, "/proj")).toBe("/proj");
  });

  test("相対パスはbase基準で解決する", () => {
    expect(resolveTabCwd("packages/cli", "/proj")).toBe("/proj/packages/cli");
    expect(resolveTabCwd("./packages/cli", "/proj")).toBe("/proj/packages/cli");
  });

  test("絶対パスはそのまま", () => {
    expect(resolveTabCwd("/elsewhere", "/proj")).toBe("/elsewhere");
  });

  test("baseが無ければ素通し（newTab側の既定＝ホームに委ねる）", () => {
    expect(resolveTabCwd(undefined, undefined)).toBeUndefined();
    expect(resolveTabCwd("rel", undefined)).toBe("rel");
  });
});
