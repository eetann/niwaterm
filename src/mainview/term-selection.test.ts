import { describe, expect, test } from "bun:test";
import { remapSelection } from "./term-selection";

describe("remapSelection", () => {
  test("選択と無関係な行だけが変わったら、同じ行・位置へ移す", () => {
    const oldText = "spin |\nhello world\nfoo";
    const newText = "spinner /\nhello world\nfoo";
    // "world"
    const sel = { anchor: oldText.indexOf("world"), focus: oldText.indexOf("world") + 5 };
    const moved = remapSelection(oldText, newText, sel);
    expect(moved).toEqual({
      anchor: newText.indexOf("world"),
      focus: newText.indexOf("world") + 5,
    });
  });

  test("後ろから前へ選んだ向きを保つ", () => {
    const oldText = "a\nbcd\nefg";
    const newText = "aaa\nbcd\nefg";
    const moved = remapSelection(oldText, newText, { anchor: 8, focus: 3 });
    expect(moved).toEqual({ anchor: 10, focus: 5 });
  });

  test("複数行にまたがる選択は、間の行も含めて全部同じなら移す", () => {
    const oldText = "x\n111\n222\n333";
    const newText = "xyz\n111\n222\n333";
    const moved = remapSelection(oldText, newText, { anchor: 3, focus: 12 });
    expect(moved).toEqual({ anchor: 5, focus: 14 });
  });

  test("選択が掛かっている行の中身が変わったら引き継がない", () => {
    expect(remapSelection("abc\ndef", "abc\ndeX", { anchor: 0, focus: 6 })).toBeNull();
  });

  test("選択していた行が差し替え後に無ければ引き継がない", () => {
    expect(remapSelection("abc\ndef", "abc", { anchor: 5, focus: 6 })).toBeNull();
  });

  test("スクロールで行がずれたら引き継がない", () => {
    expect(remapSelection("aaa\nbbb\nccc", "bbb\nccc\nddd", { anchor: 4, focus: 7 })).toBeNull();
  });

  test("行末（改行の直前）までの選択を保つ", () => {
    const moved = remapSelection("ab\ncd", "ab\ncd", { anchor: 0, focus: 2 });
    expect(moved).toEqual({ anchor: 0, focus: 2 });
  });
});
