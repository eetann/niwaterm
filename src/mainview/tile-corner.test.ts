import { describe, expect, test } from "bun:test";
import { tileContentInset } from "./tile-corner";

describe("tileContentInset", () => {
  test("角張った四角・小さな丸みでは最小の2pxを保つ", () => {
    expect(tileContentInset(0)).toBe(2);
    expect(tileContentInset(2)).toBe(2);
  });

  test("丸みが大きいほど余白を広げる", () => {
    expect(tileContentInset(6)).toBe(3);
    expect(tileContentInset(12)).toBe(5);
  });

  test("中身の角が枠の内側の弧に収まる", () => {
    for (let r = 1; r <= 40; r++) {
      const p = tileContentInset(r);
      expect(Math.SQRT2 * Math.max(0, r - p)).toBeLessThanOrEqual(r - 1 + 1e-9);
    }
  });
});
