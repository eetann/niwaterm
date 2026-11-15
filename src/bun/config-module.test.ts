import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_TYPES_DIR_NAME, syncConfigTypes } from "./config-module";

describe("syncConfigTypes", () => {
  let root: string;
  let buildDir: string;
  let configDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "niwaterm-config-module-test-"));
    buildDir = join(root, "build");
    configDir = join(root, "config");
    await mkdir(join(buildDir, "node_modules", "bun-types"), { recursive: true });
    await mkdir(configDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeBuild(stamp: string, dts: string): Promise<void> {
    await writeFile(join(buildDir, "stamp"), stamp);
    await writeFile(join(buildDir, "niwaterm.d.ts"), dts);
    await writeFile(join(buildDir, "node_modules", "bun-types", "index.d.ts"), "bun");
  }

  const typesPath = (...segments: string[]) => join(configDir, CONFIG_TYPES_DIR_NAME, ...segments);

  test("生成物一式と、ディレクトリごとgitから外す.gitignoreを書き出す", async () => {
    await writeBuild("v1", "types-v1");
    expect(await syncConfigTypes(configDir, buildDir)).toBe(true);
    expect(await readFile(typesPath("niwaterm.d.ts"), "utf8")).toBe("types-v1");
    expect(await readFile(typesPath("node_modules", "bun-types", "index.d.ts"), "utf8")).toBe(
      "bun",
    );
    expect(await readFile(typesPath(".gitignore"), "utf8")).toBe("*\n");
    expect(await readFile(typesPath("stamp"), "utf8")).toBe("v1");
  });

  test("stampが同じなら書き直さない", async () => {
    await writeBuild("v1", "types-v1");
    await syncConfigTypes(configDir, buildDir);
    const before = (await stat(typesPath("niwaterm.d.ts"))).mtimeMs;
    expect(await syncConfigTypes(configDir, buildDir)).toBe(false);
    expect((await stat(typesPath("niwaterm.d.ts"))).mtimeMs).toBe(before);
  });

  test("stampが変わったら作り直し、古い版にしか無いファイルを残さない", async () => {
    await writeBuild("v1", "types-v1");
    await syncConfigTypes(configDir, buildDir);
    await writeFile(typesPath("stale.d.ts"), "old");
    await writeBuild("v2", "types-v2");
    expect(await syncConfigTypes(configDir, buildDir)).toBe(true);
    expect(await readFile(typesPath("niwaterm.d.ts"), "utf8")).toBe("types-v2");
    expect(await stat(typesPath("stale.d.ts")).catch(() => null)).toBeNull();
  });

  test("設定ディレクトリが無ければ何も作らない", async () => {
    await writeBuild("v1", "types-v1");
    const missing = join(root, "missing");
    expect(await syncConfigTypes(missing, buildDir)).toBe(false);
    expect(await stat(missing).catch(() => null)).toBeNull();
  });
});
