import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldTriggerReload, watchConfigFile } from "./config-watcher";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// filenameの一致判定（fail-openの分岐を含む）は決定的にテストできるロジックなのでここで厳密に検証する。
// 一方、実際のfs.watchはmacOS(FSEvents)ではイベントの遅延・重複配送が起きるため、
// デバウンスの正確な回数や「対象外ファイルでは絶対に発火しない」ことの厳密な検証はここでは行わず、
// 「実際に変更を検知できる」「close/ディレクトリ不在で安全に振る舞う」という決定的な部分のみ検証する。
// ホットリロードが実機で正しく動くことはTask #15の実機動作確認で担保する。
describe("shouldTriggerReload", () => {
  test("filenameが対象と一致すればtrue", () => {
    expect(shouldTriggerReload("niwaterm.config.ts", "niwaterm.config.ts")).toBe(true);
  });

  test("filenameが対象と不一致ならfalse", () => {
    expect(shouldTriggerReload("other-file.txt", "niwaterm.config.ts")).toBe(false);
  });

  test("filenameがnull（取得不能）ならfail-openでtrue", () => {
    expect(shouldTriggerReload(null, "niwaterm.config.ts")).toBe(true);
  });
});

describe("watchConfigFile", () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-watcher-test-"));
    configPath = join(dir, "niwaterm.config.ts");
    await writeFile(configPath, "export default {};\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("ファイル変更を検知してonChangeが呼ばれる", async () => {
    let callCount = 0;
    const watcher = watchConfigFile(
      configPath,
      () => {
        callCount++;
      },
      30,
    );
    try {
      await sleep(300);
      await writeFile(configPath, "export default { keybindings: {} };\n");
      await sleep(300);
      expect(callCount).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.close();
    }
  });

  test("close()後は発火しない", async () => {
    let callCount = 0;
    const watcher = watchConfigFile(
      configPath,
      () => {
        callCount++;
      },
      30,
    );
    watcher.close();
    await writeFile(configPath, "export default { a: 999 };\n");
    await sleep(200);
    expect(callCount).toBe(0);
  });

  test("ディレクトリが存在しない場合はno-opハンドルを返す（クラッシュしない）", () => {
    const missingPath = join(dir, "does-not-exist", "niwaterm.config.ts");
    const watcher = watchConfigFile(missingPath, () => {});
    expect(() => watcher.close()).not.toThrow();
  });
});
