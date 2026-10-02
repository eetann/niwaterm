import { describe, expect, test } from "bun:test";
import { builtinThemes, isThemeName } from "./themes";

const HEX = /^#[0-9a-f]{6}$/;

describe("builtinThemes", () => {
  for (const [name, { colors }] of Object.entries(builtinThemes)) {
    test(`${name}の色はすべて#rrggbbで、ansiColorsは16色`, () => {
      expect(colors.ansiColors.length).toBe(16);
      const all = [
        colors.foreground,
        colors.background,
        colors.cursor,
        ...colors.ansiColors,
        ...Object.values(colors.ui),
      ];
      for (const color of all) expect(color).toMatch(HEX);
    });
  }
});

describe("isThemeName", () => {
  test("組み込みテーマの名前だけ受け付ける", () => {
    expect(isThemeName("tokyo-night")).toBe(true);
    expect(isThemeName("Tokyo Night")).toBe(false);
    expect(isThemeName("toString")).toBe(false);
    expect(isThemeName(1)).toBe(false);
  });
});
