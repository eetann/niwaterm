import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultWindowFrame,
  isFrameRestorable,
  loadWindowState,
  resolveWindowFrame,
  saveWindowState,
  type ScreenArea,
  type WindowFrame,
} from "./window-state";

const primary: ScreenArea = { x: 0, y: 0, width: 1920, height: 1080 };
const secondary: ScreenArea = { x: 1920, y: 0, width: 1280, height: 720 };

describe("defaultWindowFrame", () => {
  test("プライマリ作業領域の80%を中央寄せする", () => {
    expect(defaultWindowFrame([primary, secondary])).toEqual({
      x: 192,
      y: 108,
      width: 1536,
      height: 864,
    });
  });

  test("作業領域の原点がずれていても中央寄せになる", () => {
    expect(defaultWindowFrame([{ x: 100, y: 50, width: 1000, height: 500 }])).toEqual({
      x: 200,
      y: 100,
      width: 800,
      height: 400,
    });
  });

  test("ディスプレイ情報が無いときは固定値へ落ちる", () => {
    expect(defaultWindowFrame([])).toEqual({ x: 200, y: 200, width: 900, height: 600 });
  });
});

describe("isFrameRestorable", () => {
  test("作業領域に収まっているフレームは復元できる", () => {
    expect(isFrameRestorable({ x: 100, y: 100, width: 800, height: 600 }, [primary])).toBe(true);
  });

  test("サブディスプレイ上のフレームも復元できる", () => {
    expect(
      isFrameRestorable({ x: 2000, y: 100, width: 800, height: 500 }, [primary, secondary]),
    ).toBe(true);
  });

  test("外したディスプレイ上のフレームは復元しない", () => {
    expect(isFrameRestorable({ x: 2000, y: 100, width: 800, height: 500 }, [primary])).toBe(false);
  });

  test("解像度が下がって大半がはみ出すフレームは復元しない", () => {
    expect(isFrameRestorable({ x: 0, y: 0, width: 3000, height: 2000 }, [primary])).toBe(false);
  });

  test("タイトルバーが画面上端より上にあるフレームは復元しない", () => {
    expect(isFrameRestorable({ x: 100, y: -40, width: 800, height: 600 }, [primary])).toBe(false);
  });

  test("タイトルバーがほとんど画面外なフレームは復元しない", () => {
    expect(isFrameRestorable({ x: 1870, y: 100, width: 800, height: 600 }, [primary])).toBe(false);
  });

  test("サイズが不正なフレームは復元しない", () => {
    expect(isFrameRestorable({ x: 0, y: 0, width: 0, height: 600 }, [primary])).toBe(false);
    expect(isFrameRestorable({ x: Number.NaN, y: 0, width: 800, height: 600 }, [primary])).toBe(
      false,
    );
  });

  test("ディスプレイ情報が無いときは判定できないのでfalse", () => {
    expect(isFrameRestorable({ x: 100, y: 100, width: 800, height: 600 }, [])).toBe(false);
  });
});

describe("resolveWindowFrame", () => {
  test("復元できるフレームはそのまま使う", () => {
    const saved: WindowFrame = { x: 100, y: 100, width: 800, height: 600 };
    expect(resolveWindowFrame(saved, [primary])).toEqual(saved);
  });

  test("画面外のフレームは既定へ戻す", () => {
    expect(resolveWindowFrame({ x: 5000, y: 5000, width: 800, height: 600 }, [primary])).toEqual(
      defaultWindowFrame([primary]),
    );
  });

  test("保存値が無ければ既定を使う", () => {
    expect(resolveWindowFrame(null, [primary])).toEqual(defaultWindowFrame([primary]));
  });

  test("ディスプレイ情報が取れないときは保存値を尊重する", () => {
    const saved: WindowFrame = { x: 5000, y: 5000, width: 800, height: 600 };
    expect(resolveWindowFrame(saved, [])).toEqual(saved);
  });
});

describe("loadWindowState / saveWindowState", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-window-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("保存したフレームを読み戻せる", () => {
    const path = join(dir, "nested", "window.json");
    saveWindowState(path, { x: 10.4, y: 20.6, width: 800.2, height: 600.8 });
    expect(loadWindowState(path)).toEqual({ x: 10, y: 21, width: 800, height: 601 });
  });

  test("ファイルが無ければnull", () => {
    expect(loadWindowState(join(dir, "window.json"))).toBeNull();
  });

  test("壊れたJSONはnull", async () => {
    const path = join(dir, "window.json");
    await writeFile(path, "{ broken");
    expect(loadWindowState(path)).toBeNull();
  });

  test("versionが違えばnull", async () => {
    const path = join(dir, "window.json");
    await writeFile(path, JSON.stringify({ version: 2, x: 0, y: 0, width: 800, height: 600 }));
    expect(loadWindowState(path)).toBeNull();
  });

  test("値が欠けていればnull", async () => {
    const path = join(dir, "window.json");
    await writeFile(path, JSON.stringify({ version: 1, x: 0, y: 0, width: 800 }));
    expect(loadWindowState(path)).toBeNull();
  });
});
