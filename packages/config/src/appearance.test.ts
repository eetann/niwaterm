import { describe, expect, test } from "bun:test";
import { defaultAppearance, scaleLineHeight } from "./appearance";

describe("defaultAppearance", () => {
  test("ansiColorsは16件（ANSI標準色0-15）", () => {
    expect(defaultAppearance.ansiColors.length).toBe(16);
  });

  test("フォント・色フィールドが全て埋まっている", () => {
    expect(typeof defaultAppearance.fontFamily).toBe("string");
    expect(typeof defaultAppearance.fontSize).toBe("number");
    expect(typeof defaultAppearance.lineHeight).toBe("number");
    expect(typeof defaultAppearance.foreground).toBe("string");
    expect(typeof defaultAppearance.background).toBe("string");
  });

  test("ansiColorsの各要素は非空文字列", () => {
    for (const color of defaultAppearance.ansiColors) {
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });
});

describe("scaleLineHeight", () => {
  const base = { fontSize: 13, lineHeight: 18 };

  test("等倍なら元の行の高さのまま", () => {
    expect(scaleLineHeight(base, 13)).toBe(18);
  });

  test("拡大すると行間の比率を保ったまま行の高さも伸びる", () => {
    expect(scaleLineHeight(base, 26)).toBe(36);
    expect(scaleLineHeight(base, 20)).toBe(Math.round((18 / 13) * 20));
  });

  test("縮小すると行の高さも縮む", () => {
    expect(scaleLineHeight(base, 6)).toBe(Math.round((18 / 13) * 6));
  });

  test("常に整数（小数だとサブピクセルの丸めで行の境界がずれる）", () => {
    for (let size = 6; size <= 48; size++) {
      expect(Number.isInteger(scaleLineHeight(base, size))).toBe(true);
    }
  });

  test("基準のフォントサイズが不正なら元の行の高さを返す", () => {
    expect(scaleLineHeight({ fontSize: 0, lineHeight: 18 }, 26)).toBe(18);
    expect(scaleLineHeight({ fontSize: Number.NaN, lineHeight: 18 }, 26)).toBe(18);
  });
});
