import { describe, expect, test } from "bun:test";
import { hoverPositionAt } from "./hover-buttons";

const size = { width: 300, height: 300 };
/** 帯の太さは枠ごとの設定値。テストでは固定の値で判定だけを見る */
const TRIGGER = 12;

describe("hoverPositionAt", () => {
  test("上辺は左端・中央・右端の3つに分かれる", () => {
    expect(hoverPositionAt(10, 0, size, TRIGGER)).toBe("top-left");
    expect(hoverPositionAt(150, 0, size, TRIGGER)).toBe("top");
    expect(hoverPositionAt(290, 0, size, TRIGGER)).toBe("top-right");
  });

  test("下辺も同じ3つに分かれる", () => {
    expect(hoverPositionAt(10, 300, size, TRIGGER)).toBe("bottom-left");
    expect(hoverPositionAt(150, 300, size, TRIGGER)).toBe("bottom");
    expect(hoverPositionAt(290, 300, size, TRIGGER)).toBe("bottom-right");
  });

  test("左右の辺は縦方向の中央半分でだけ反応する", () => {
    expect(hoverPositionAt(0, 150, size, TRIGGER)).toBe("left");
    expect(hoverPositionAt(300, 150, size, TRIGGER)).toBe("right");
    expect(hoverPositionAt(0, 80, size, TRIGGER)).toBe("left");
    expect(hoverPositionAt(300, 220, size, TRIGGER)).toBe("right");
    expect(hoverPositionAt(0, 50, size, TRIGGER)).toBeNull();
    expect(hoverPositionAt(300, 250, size, TRIGGER)).toBeNull();
  });

  test("四隅は上下の辺が持つ", () => {
    expect(hoverPositionAt(0, 0, size, TRIGGER)).toBe("top-left");
    expect(hoverPositionAt(300, 300, size, TRIGGER)).toBe("bottom-right");
  });

  test("帯の太さを超えたら中央扱いで何も返さない", () => {
    expect(hoverPositionAt(150, TRIGGER, size, TRIGGER)).toBe("top");
    expect(hoverPositionAt(150, TRIGGER + 1, size, TRIGGER)).toBeNull();
    expect(hoverPositionAt(TRIGGER + 1, 150, size, TRIGGER)).toBeNull();
  });

  test("領域の外・大きさが無い領域では何も返さない", () => {
    expect(hoverPositionAt(-1, 0, size, TRIGGER)).toBeNull();
    expect(hoverPositionAt(0, 301, size, TRIGGER)).toBeNull();
    expect(hoverPositionAt(0, 0, { width: 0, height: 0 }, TRIGGER)).toBeNull();
  });
});
