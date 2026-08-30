import { describe, expect, test } from "bun:test";
import {
  computeCellGlyphTransform,
  identityCellGlyphTransform,
  isCellGlyphChar,
  isIdentityCellGlyphTransform,
} from "./cell-glyph";

describe("isCellGlyphChar", () => {
  test.each([
    [0x0041, false, "ASCII 'A'"],
    [0x24ff, false, "罫線素片の直前"],
    [0x2500, true, "罫線素片 下端 ─"],
    [0x257f, true, "罫線素片 上端"],
    [0x2580, true, "ブロック要素 下端 ▀"],
    [0x2588, true, "全ブロック █"],
    [0x259d, true, "四分ブロック ▝"],
    [0x259f, true, "ブロック要素 上端"],
    [0x25a0, false, "ブロック要素の直後（幾何学模様）"],
    [0x2800, false, "点字（セル充填前提ではないので対象外）"],
    [0xe0b0, false, "Powerlineセパレータ（私用領域なので対象外）"],
    [0x1faff, false, "レガシー記号の直前"],
    [0x1fb00, true, "レガシー計算記号 下端"],
    [0x1fbff, true, "レガシー計算記号 上端"],
    [0x1fc00, false, "レガシー計算記号の直後"],
  ])("U+%s -> %s (%s)", (cp, expected) => {
    expect(isCellGlyphChar(cp as number)).toBe(expected as boolean);
  });
});

describe("computeCellGlyphTransform", () => {
  test("インク矩形を行ボックス全体へ写す", () => {
    // 行高18px、ベースラインは上端から14px、█は上に11px・下に3pxのインクを持つ
    // → インク高14pxを18pxへ拡大し、インク上端(y=3)が行ボックス上端(y=0)へ来るようにずらす
    const t = computeCellGlyphTransform({
      lineHeight: 18,
      baseline: 14,
      inkAscent: 11,
      inkDescent: 3,
    });
    expect(t.scaleY).toBeCloseTo(18 / 14);
    expect(t.shiftY).toBeCloseTo((-18 / 14) * 3);
    // 変換後、インクの上端が0、下端が18になる
    const top = t.shiftY + t.scaleY * (14 - 11);
    const bottom = t.shiftY + t.scaleY * (14 + 3);
    expect(top).toBeCloseTo(0);
    expect(bottom).toBeCloseTo(18);
  });

  test("行高がインク高と一致していれば恒等変換になる", () => {
    const t = computeCellGlyphTransform({
      lineHeight: 14,
      baseline: 11,
      inkAscent: 11,
      inkDescent: 3,
    });
    expect(isIdentityCellGlyphTransform(t)).toBe(true);
  });

  test.each([
    [{ lineHeight: 18, baseline: 14, inkAscent: 0, inkDescent: 0 }, "インク高0（グリフ欠落）"],
    [{ lineHeight: 0, baseline: 14, inkAscent: 11, inkDescent: 3 }, "行高0"],
    [
      { lineHeight: 18, baseline: Number.NaN, inkAscent: 11, inkDescent: 3 },
      "ベースライン測定失敗",
    ],
    [{ lineHeight: 18, baseline: 5, inkAscent: 4, inkDescent: 1 }, "倍率が大きすぎる"],
    [{ lineHeight: 10, baseline: 24, inkAscent: 22, inkDescent: 6 }, "倍率が小さすぎる"],
  ])("測定値が異常なら変換なしへフォールバックする: %#（%s）", (metrics) => {
    expect(computeCellGlyphTransform(metrics)).toEqual(identityCellGlyphTransform);
  });
});
