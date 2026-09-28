import { describe, expect, test } from "bun:test";
import { HOVER_TRIGGER_PX, hoverPositionAt } from "./hover-buttons";

const size = { width: 300, height: 300 };

describe("hoverPositionAt", () => {
  test("上辺は左端・中央・右端の3つに分かれる", () => {
    expect(hoverPositionAt(10, 0, size)).toBe("top-left");
    expect(hoverPositionAt(150, 0, size)).toBe("top");
    expect(hoverPositionAt(290, 0, size)).toBe("top-right");
  });

  test("下辺も同じ3つに分かれる", () => {
    expect(hoverPositionAt(10, 300, size)).toBe("bottom-left");
    expect(hoverPositionAt(150, 300, size)).toBe("bottom");
    expect(hoverPositionAt(290, 300, size)).toBe("bottom-right");
  });

  test("左右の辺は縦方向の中央半分でだけ反応する", () => {
    expect(hoverPositionAt(0, 150, size)).toBe("left");
    expect(hoverPositionAt(300, 150, size)).toBe("right");
    expect(hoverPositionAt(0, 80, size)).toBe("left");
    expect(hoverPositionAt(300, 220, size)).toBe("right");
    expect(hoverPositionAt(0, 50, size)).toBeNull();
    expect(hoverPositionAt(300, 250, size)).toBeNull();
  });

  test("四隅は上下の辺が持つ", () => {
    expect(hoverPositionAt(0, 0, size)).toBe("top-left");
    expect(hoverPositionAt(300, 300, size)).toBe("bottom-right");
  });

  test("帯の太さを超えたら中央扱いで何も返さない", () => {
    expect(hoverPositionAt(150, HOVER_TRIGGER_PX, size)).toBe("top");
    expect(hoverPositionAt(150, HOVER_TRIGGER_PX + 1, size)).toBeNull();
    expect(hoverPositionAt(HOVER_TRIGGER_PX + 1, 150, size)).toBeNull();
  });

  test("領域の外・大きさが無い領域では何も返さない", () => {
    expect(hoverPositionAt(-1, 0, size)).toBeNull();
    expect(hoverPositionAt(0, 301, size)).toBeNull();
    expect(hoverPositionAt(0, 0, { width: 0, height: 0 })).toBeNull();
  });
});
