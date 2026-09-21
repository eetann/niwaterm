import { describe, expect, test } from "bun:test";
import { createDirExistenceCache, dirExistsSync } from "./dir-existence";

/** マイクロタスクに積まれた非同期チェックが片付くまで待つ */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createDirExistenceCache", () => {
  test("未チェックのパスは存在扱いで即答し、裏のチェックで消えていればonChangeで知らせる", async () => {
    let changes = 0;
    const cache = createDirExistenceCache({
      onChange: () => changes++,
      dirExists: async () => false,
      intervalMs: 10_000,
    });

    expect(cache.isMissing("/gone")).toBe(false);
    await flush();

    expect(cache.isMissing("/gone")).toBe(true);
    expect(changes).toBe(1);
    cache.dispose();
  });

  test("存在するパスはonChangeを呼ばない", async () => {
    let changes = 0;
    const cache = createDirExistenceCache({
      onChange: () => changes++,
      dirExists: async () => true,
      intervalMs: 10_000,
    });

    cache.isMissing("/here");
    await flush();

    expect(cache.isMissing("/here")).toBe(false);
    expect(changes).toBe(0);
    cache.dispose();
  });

  test("同じパスを何度問い合わせてもstatは初回の1回だけ（描画のたびに叩かない）", async () => {
    let calls = 0;
    const cache = createDirExistenceCache({
      onChange: () => {},
      dirExists: async () => {
        calls++;
        return true;
      },
      intervalMs: 10_000,
    });

    for (let i = 0; i < 100; i++) cache.isMissing("/here");
    await flush();

    expect(calls).toBe(1);
    cache.dispose();
  });

  test("タイマーの周回で消えたディレクトリを拾い直す", async () => {
    let exists = true;
    let changes = 0;
    const cache = createDirExistenceCache({
      onChange: () => changes++,
      dirExists: async () => exists,
      intervalMs: 1,
    });

    cache.isMissing("/here");
    await flush();
    exists = false;
    // 待つ間もisMissingを呼び続ける（描画が続いている状況と同じ。問い合わせが途絶えた
    // パスはキャッシュから捨てられるため、放置して待つとこのテストは成立しない）
    const deadline = Date.now() + 1000;
    while (!cache.isMissing("/here") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    expect(cache.isMissing("/here")).toBe(true);
    expect(changes).toBe(1);
    cache.dispose();
  });

  test("問い合わせが途絶えたパスはキャッシュから捨てる（閉じたBoardのパスを見張り続けない）", async () => {
    let calls = 0;
    const cache = createDirExistenceCache({
      onChange: () => {},
      dirExists: async () => {
        calls++;
        return true;
      },
      intervalMs: 1,
    });

    cache.isMissing("/here");
    await new Promise((resolve) => setTimeout(resolve, 60));
    const callsAfterPrune = calls;

    // 捨てられた後は問い合わせのたびに登録し直すので、statが再び走る
    cache.isMissing("/here");
    await flush();

    expect(calls).toBeGreaterThan(callsAfterPrune);
    cache.dispose();
  });
});

describe("dirExistsSync", () => {
  test("存在するディレクトリはtrue", () => {
    expect(dirExistsSync(import.meta.dir)).toBe(true);
  });

  test("存在しないパスはfalse", () => {
    expect(dirExistsSync(`${import.meta.dir}/no-such-dir`)).toBe(false);
  });

  test("ファイルはディレクトリではないのでfalse", () => {
    expect(dirExistsSync(import.meta.path)).toBe(false);
  });
});
