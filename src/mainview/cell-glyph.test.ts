import { describe, expect, test } from "bun:test";
import {
  computeCellGlyphTransform,
  identityCellGlyphTransform,
  isCellGlyphChar,
  isIdentityCellGlyphTransform,
  measureInkExtent,
  shadeAlphaPercent,
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
    // 行高18px、ベースラインは上端から14px、█は等倍だと上に11px・下に3pxのインクを持つ
    // → 18/14倍で描くとインクは上に14.14px・下に3.86pxになり、行ボックスをちょうど覆う
    const scaleY = 18 / 14;
    const t = computeCellGlyphTransform({
      lineHeight: 18,
      baseline: 14,
      scaleY,
      inkAscent: 11 * scaleY,
      inkDescent: 3 * scaleY,
    });
    expect(t.scaleY).toBeCloseTo(scaleY);
    expect(t.shiftY).toBeCloseTo(-scaleY * 3);
    // 変換後、インクの上端が0、下端が18になる
    const top = t.shiftY + t.scaleY * 14 - 11 * scaleY;
    const bottom = t.shiftY + t.scaleY * 14 + 3 * scaleY;
    expect(top).toBeCloseTo(0);
    expect(bottom).toBeCloseTo(18);
  });

  test("インクが行より大きければ上下へ均等にはみ出させる（ppemの丸めで1段階大きいグリフになる場合）", () => {
    // Windows実機の実測値: font-size 13px / 行高18px / ベースライン13px。
    // 等倍のインク高は17.36pxしかないが、ppemを14へ上げると19pxになり行高を1px超える
    const scaleY = 14 / 13;
    const t = computeCellGlyphTransform({
      lineHeight: 18,
      baseline: 13,
      scaleY,
      inkAscent: 14.365,
      inkDescent: 4.635,
    });
    const top = t.shiftY + t.scaleY * 13 - 14.365;
    const bottom = t.shiftY + t.scaleY * 13 + 4.635;
    expect(top).toBeCloseTo(-0.5);
    expect(bottom).toBeCloseTo(18.5);
  });

  test("行高がインク高と一致していれば恒等変換になる", () => {
    const t = computeCellGlyphTransform({
      lineHeight: 14,
      baseline: 11,
      scaleY: 1,
      inkAscent: 11,
      inkDescent: 3,
    });
    expect(isIdentityCellGlyphTransform(t)).toBe(true);
  });

  test.each([
    [
      { lineHeight: 18, baseline: 14, scaleY: 1, inkAscent: 0, inkDescent: 0 },
      "インク高0（グリフ欠落）",
    ],
    [{ lineHeight: 0, baseline: 14, scaleY: 1, inkAscent: 11, inkDescent: 3 }, "行高0"],
    [
      { lineHeight: 18, baseline: Number.NaN, scaleY: 1, inkAscent: 11, inkDescent: 3 },
      "ベースライン測定失敗",
    ],
    [{ lineHeight: 18, baseline: 5, scaleY: 3, inkAscent: 12, inkDescent: 3 }, "倍率が大きすぎる"],
    [
      { lineHeight: 10, baseline: 24, scaleY: 0.3, inkAscent: 7, inkDescent: 2 },
      "倍率が小さすぎる",
    ],
  ])("測定値が異常なら変換なしへフォールバックする: %#（%s）", (metrics) => {
    expect(computeCellGlyphTransform(metrics)).toEqual(identityCellGlyphTransform);
  });
});

describe("measureInkExtent", () => {
  /** 指定した行だけ被覆率を持つ、length行分の走査結果を作る */
  const scan = (length: number, fills: Array<[number, number]>) => {
    const rows = Array.from({ length }, () => 0);
    for (const [y, v] of fills) rows[y] = v;
    return rows;
  };

  test("端が完全被覆なら整数の端になる", () => {
    const rows = scan(20, [
      [5, 1],
      [6, 1],
      [7, 1],
    ]);
    const ink = measureInkExtent(rows, 8);
    expect(ink?.inkAscent).toBeCloseTo(3);
    expect(ink?.inkDescent).toBeCloseTo(0);
  });

  test("端の部分被覆から小数の端を復元する（Windows実測の再現）", () => {
    // 行26が0.365だけ被覆、27-43が完全被覆、ベースラインは40
    const rows = scan(
      60,
      Array.from({ length: 18 }, (_, i) => [26 + i, i === 0 ? 0.365 : 1] as [number, number]),
    );
    const ink = measureInkExtent(rows, 40);
    expect(ink?.inkAscent).toBeCloseTo(13.365);
    expect(ink?.inkDescent).toBeCloseTo(4);
  });

  test("アンチエイリアスの裾は拾わない", () => {
    const rows = scan(20, [
      [4, 0.01],
      [5, 1],
      [6, 1],
      [7, 0.5],
      [8, 0.01],
    ]);
    const ink = measureInkExtent(rows, 8);
    expect(ink?.inkAscent).toBeCloseTo(3);
    expect(ink?.inkDescent).toBeCloseTo(-0.5);
  });

  test("インクが無ければnull（グリフ欠落・描画失敗）", () => {
    expect(measureInkExtent(scan(20, []), 8)).toBeNull();
  });
});

describe("shadeAlphaPercent", () => {
  test.each([
    [0x2590, null, "シェードの直前 ▐"],
    [0x2591, 25, "薄いシェード ░"],
    [0x2592, 50, "中間のシェード ▒"],
    [0x2593, 75, "濃いシェード ▓"],
    [0x2594, null, "シェードの直後 ▔"],
    [0x2588, null, "全ブロック █（塗りつぶしはグリフのまま）"],
    [0x0041, null, "ASCII 'A'"],
  ])("U+%s -> %s (%s)", (cp, expected) => {
    expect(shadeAlphaPercent(cp as number)).toBe(expected as number | null);
  });
});
