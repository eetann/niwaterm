import { describe, expect, test } from "bun:test";
import { defaultAppearance } from "./appearance";

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
