import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathCompletions } from "./paths";

describe("pathCompletions", () => {
  let dir: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-completion-paths-test-"));
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, ".hidden"));
    await writeFile(join(dir, "note.md"), "");
    await symlink(join(dir, "src"), join(dir, "link"));
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  });

  test("ディレクトリには末尾の区切りを付けて、そのまま潜れるようにする", () => {
    expect(pathCompletions("", true)).toContainEqual({ value: "src/" });
  });

  test("ディレクトリへのシンボリックリンクもディレクトリとして扱う", () => {
    expect(pathCompletions("", true)).toContainEqual({ value: "link/" });
  });

  test("ディレクトリだけを求められたらファイルは返さない", () => {
    expect(pathCompletions("", true)).not.toContainEqual({ value: "note.md" });
    expect(pathCompletions("", false)).toContainEqual({ value: "note.md" });
  });

  test("隠しファイルはドットを打つまで候補にしない", () => {
    expect(pathCompletions("", true)).not.toContainEqual({ value: ".hidden/" });
    expect(pathCompletions(".", true)).toContainEqual({ value: ".hidden/" });
  });

  test("入力済みのディレクトリを頭に付けたまま返す（シェルがそのまま挿入するため）", () => {
    expect(pathCompletions("./sr", true)).toContainEqual({ value: "./src/" });
  });

  test("存在しないディレクトリでは候補を出さない", () => {
    expect(pathCompletions("no-such-dir/", true)).toEqual([]);
  });
});
