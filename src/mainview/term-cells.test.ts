import { describe, expect, test } from "bun:test";
import { cellAt } from "./term-cells";

describe("cellAt", () => {
  const screen = "abc\nあいu\n\nxy";

  test("半角文字の桁をそのまま引く", () => {
    expect(cellAt(screen, 0, 0)).toEqual({ char: "a", col: 0, wide: false });
    expect(cellAt(screen, 2, 0)).toEqual({ char: "c", col: 2, wide: false });
  });

  test("全角文字は2桁を占める", () => {
    expect(cellAt(screen, 0, 1)).toEqual({ char: "あ", col: 0, wide: true });
    expect(cellAt(screen, 2, 1)).toEqual({ char: "い", col: 2, wide: true });
    expect(cellAt(screen, 4, 1)).toEqual({ char: "u", col: 4, wide: false });
  });

  test("全角文字の右半分は左半分の桁として返す", () => {
    expect(cellAt(screen, 1, 1)).toEqual({ char: "あ", col: 0, wide: true });
    expect(cellAt(screen, 3, 1)).toEqual({ char: "い", col: 2, wide: true });
  });

  test("行の内容より右の桁はnull（フォーマッタは行末の空白を出力しない）", () => {
    expect(cellAt(screen, 3, 0)).toBeNull();
    expect(cellAt(screen, 0, 2)).toBeNull();
  });

  test("存在しない行はnull", () => {
    expect(cellAt(screen, 0, 4)).toBeNull();
    expect(cellAt("", 0, 0)).toBeNull();
  });

  test("最終行は改行が無くても引ける", () => {
    expect(cellAt(screen, 1, 3)).toEqual({ char: "y", col: 1, wide: false });
  });

  test("負の座標はnull", () => {
    expect(cellAt(screen, -1, 0)).toBeNull();
    expect(cellAt(screen, 0, -1)).toBeNull();
  });

  test("サロゲートペアを1文字として数える", () => {
    expect(cellAt("a🐧b", 1, 0)).toEqual({ char: "🐧", col: 1, wide: true });
    expect(cellAt("a🐧b", 3, 0)).toEqual({ char: "b", col: 3, wide: false });
  });
});
