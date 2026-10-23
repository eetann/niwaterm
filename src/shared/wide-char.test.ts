import { describe, expect, test } from "bun:test";
import { charWidth, isWideChar, splitCells } from "./wide-char";

describe("isWideChar", () => {
  test.each([
    [0x0041, false, "ASCII 'A'"],
    [0x109f, false, "Hangul Jamo直前（早期returnの境界）"],
    [0x1100, true, "Hangul Jamo 下端"],
    [0x115f, true, "Hangul Jamo 上端"],
    [0x1160, false, "Hangul Jamo直後の隙間"],
    [0x2e7f, false, "CJK部首記号の直前"],
    [0x2e80, true, "CJK部首記号 下端"],
    [0x303e, true, "CJK部首記号 上端"],
    [0x303f, false, "ひらがなブロック直前の隙間"],
    [0x3041, true, "ひらがな等ブロック 下端"],
    [0x3099, false, "結合用濁点（幅0）"],
    [0x309a, false, "結合用半濁点（幅0）"],
    [0x309b, true, "濁点（単体のスペーシング文字）"],
    [0x33ff, true, "ひらがな等ブロック 上端"],
    [0x3400, true, "CJK拡張A 下端"],
    [0x4dbf, true, "CJK拡張A 上端"],
    [0x4dc0, false, "隙間（易経記号ブロック）"],
    [0x4e00, true, "CJK統合漢字 下端"],
    [0x65e5, true, "CJK統合漢字の代表例「日」"],
    [0x9fff, true, "CJK統合漢字 上端"],
    [0xa000, true, "Yi 下端"],
    [0xa4cf, true, "Yi 上端"],
    [0xa4d0, false, "Hangul音節直前の隙間"],
    [0xac00, true, "Hangul音節 下端"],
    [0xd7a3, true, "Hangul音節 上端"],
    [0xd7a4, false, "CJK互換漢字直前の隙間"],
    [0xf900, true, "CJK互換漢字 下端"],
    [0xfaff, true, "CJK互換漢字 上端"],
    [0xfb00, false, "隙間（合字ブロック等）"],
    [0xfe30, true, "CJK互換形 下端"],
    [0xfe4f, true, "CJK互換形 上端"],
    [0xfe50, false, "隙間"],
    [0xff00, true, "全角英数記号 下端"],
    [0xff60, true, "全角英数記号 上端"],
    [0xff61, false, "半角カタカナ開始（隙間）"],
    [0xffe0, true, "全角記号 下端"],
    [0xffe6, true, "全角記号 上端"],
    [0xffe7, false, "直後の隙間"],
    [0xffff, false, "BMP最終コードポイント（隙間）"],
    [0x1f300, true, "絵文字ブロック 下端"],
    [0x1f600, true, "絵文字の代表例「😀」"],
    [0x1faff, true, "絵文字ブロック 上端"],
    [0x1fb00, false, "直後の隙間"],
    [0x20000, true, "CJK拡張B〜 下端"],
    [0x3fffd, true, "CJK拡張B〜 上端"],
    [0x3fffe, false, "上端超え"],
  ])("isWideChar(0x%s) -> %p (%s)", (cp, expected) => {
    expect(isWideChar(cp)).toBe(expected);
  });
});

describe("charWidth", () => {
  test.each([
    ["a", 1],
    ["あ", 2],
    ["゙", 0],
    ["́", 0],
    ["️", 0],
  ])("charWidth(%p) -> %p", (ch, expected) => {
    expect(charWidth(ch)).toBe(expected as 0 | 1 | 2);
  });
});

describe("splitCells", () => {
  test("NFDの濁点は基底文字と同じセルにまとめる", () => {
    expect(splitCells("ディスプレイ")).toEqual([
      { text: "デ", width: 2 },
      { text: "ィ", width: 2 },
      { text: "ス", width: 2 },
      { text: "プ", width: 2 },
      { text: "レ", width: 2 },
      { text: "イ", width: 2 },
    ]);
  });

  test("半角の基底文字に付く結合文字も幅を増やさない", () => {
    expect(splitCells("éx")).toEqual([
      { text: "é", width: 1 },
      { text: "x", width: 1 },
    ]);
  });

  test("先頭の結合文字は単体で幅1のセルにする", () => {
    expect(splitCells("゙a")).toEqual([
      { text: "゙", width: 1 },
      { text: "a", width: 1 },
    ]);
  });
});
