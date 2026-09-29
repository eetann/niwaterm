import { describe, expect, test } from "bun:test";
import type { KittyPlacement } from "../bun/ghostty";
import { placementRect } from "./kitty-images";

const base: KittyPlacement = {
  imageKey: "1",
  col: 0,
  row: 0,
  xOffset: 0,
  yOffset: 0,
  width: 0,
  height: 0,
  sourceX: 0,
  sourceY: 0,
  sourceWidth: 0,
  sourceHeight: 0,
  z: 0,
};

describe("placementRect", () => {
  test("セル寸法が整数ならbun側の値をそのまま使う", () => {
    const rect = placementRect(
      { ...base, col: 2, row: 3, xOffset: 4, yOffset: 5, width: 30, height: 40 },
      10,
      20,
    );
    expect(rect).toEqual({ left: 24, top: 65, width: 30, height: 40 });
  });

  test("実測のセル寸法が小数なら、丸めた寸法との比で伸縮して文字のグリッドに揃える", () => {
    // bun側へは8x17として伝わり、3x2セルの配置は24x34ピクセルで届く
    const rect = placementRect({ ...base, col: 1, row: 1, width: 24, height: 34 }, 8.4, 16.8);
    expect(rect.left).toBeCloseTo(8.4);
    expect(rect.top).toBeCloseTo(16.8);
    expect(rect.width).toBeCloseTo(8.4 * 3);
    expect(rect.height).toBeCloseTo(16.8 * 2);
  });

  test("上へスクロールアウトしかけた配置は負の位置になる", () => {
    expect(placementRect({ ...base, row: -2 }, 10, 20).top).toBe(-40);
  });
});
