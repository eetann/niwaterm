import { describe, expect, test } from "bun:test";
import { isLightBackground } from "./theme-mode";

describe("isLightBackground", () => {
  test.each([
    [30, 30, 46, false, "既定の背景 #1e1e2e"],
    [0, 0, 0, false, "黒"],
    [255, 255, 255, true, "白"],
    [239, 241, 245, true, "Catppuccin Latteの背景 #eff1f5"],
    [128, 128, 128, false, "中間のグレーは暗い側へ倒す"],
    [0, 255, 0, true, "緑は輝度が高いので明るい側"],
    [0, 0, 255, false, "青は輝度が低いので暗い側"],
  ])("%d,%d,%d -> %p (%s)", (r, g, b, expected) => {
    expect(isLightBackground(r, g, b)).toBe(expected);
  });
});
