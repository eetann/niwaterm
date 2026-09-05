import { describe, expect, test } from "bun:test";
import { resolveTileDropZone, splitForDropZone } from "./tile-drop-zone";

const size = { width: 400, height: 200 };

describe("resolveTileDropZone", () => {
  test.each([
    ["中央", 200, 100, "center"],
    ["左端", 10, 100, "left"],
    ["右端", 390, 100, "right"],
    ["上端", 200, 10, "top"],
    ["下端", 200, 190, "bottom"],
  ] as const)("%s は %p", (_label, x, y, expected) => {
    expect(resolveTileDropZone(x, y, size)).toBe(expected);
  });

  test.each([
    ["帯のすぐ内側（左）", 101, 100, "center"],
    ["帯の境界（左）", 99, 100, "left"],
    ["帯のすぐ内側（上）", 200, 51, "center"],
    ["帯の境界（上）", 200, 49, "top"],
  ] as const)("%s は %p", (_label, x, y, expected) => {
    expect(resolveTileDropZone(x, y, size)).toBe(expected);
  });

  test("端の帯が重なる四隅は辺までの距離が近い方が勝つ", () => {
    // 左上の角: 左端から5%、上端から10%なので左が勝つ
    expect(resolveTileDropZone(20, 20, size)).toBe("left");
    // 右下の角: 右端から10%、下端から5%なので下が勝つ
    expect(resolveTileDropZone(360, 190, size)).toBe("bottom");
  });

  test("サイズが0のタイルはcenterを返す", () => {
    expect(resolveTileDropZone(0, 0, { width: 0, height: 0 })).toBe("center");
  });
});

describe("splitForDropZone", () => {
  test.each([
    ["left", { orientation: "vertical", placement: "before" }],
    ["right", { orientation: "vertical", placement: "after" }],
    ["top", { orientation: "horizontal", placement: "before" }],
    ["bottom", { orientation: "horizontal", placement: "after" }],
  ] as const)("%s -> %p", (zone, expected) => {
    expect(splitForDropZone(zone)).toEqual(expected);
  });

  test("centerは分割しない", () => {
    expect(splitForDropZone("center")).toBeNull();
  });
});
