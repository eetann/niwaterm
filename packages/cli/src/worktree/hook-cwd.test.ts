import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInWorktree } from "./hook-cwd";

describe("runInWorktree", () => {
  const original = process.cwd();
  afterEach(() => process.chdir(original));

  test("フック実行中はワークツリーがcwdになり、Bun.$もそこで走る", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "niwaterm-hook-cwd-")));
    const seen = await runInWorktree(dir, async () => ({
      cwd: process.cwd(),
      shell: (await Bun.$`pwd`.text()).trim(),
    }));
    expect(seen.cwd).toBe(dir);
    expect(realpathSync(seen.shell)).toBe(dir);
    expect(process.cwd()).toBe(original);
  });

  test("フックが例外を投げてもcwdを元へ戻す", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "niwaterm-hook-cwd-")));
    await expect(
      runInWorktree(dir, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(process.cwd()).toBe(original);
  });
});
