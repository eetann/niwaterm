import { describe, expect, test } from "bun:test";
import { remapSelection, selectionCells } from "./term-selection";

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

describe("selectionCells", () => {
  test("前から後ろへ選ぶと、始点がanchor・終端の1文字手前がcursorになる", () => {
    const text = "hello world\nfoo";
    const lo = text.indexOf("world");
    expect(selectionCells(text, { anchor: lo, focus: lo + 5 })).toEqual({
      anchor: { x: 6, y: 0 },
      cursor: { x: 10, y: 0 },
    });
  });

  test("後ろから前へ選ぶと、cursorが前側の端になる", () => {
    const text = "abc\ndef";
    // "c\nde" を後ろから選ぶ
    expect(selectionCells(text, { anchor: 6, focus: 2 })).toEqual({
      anchor: { x: 1, y: 1 },
      cursor: { x: 2, y: 0 },
    });
  });

  test("全角文字は2桁と数え、全角文字のセルは開始桁を指す", () => {
    const text = "あいう x";
    // "いう"
    expect(selectionCells(text, { anchor: 1, focus: 3 })).toEqual({
      anchor: { x: 2, y: 0 },
      cursor: { x: 4, y: 0 },
    });
  });

  test("サロゲートペアの文字も1セルとして扱う", () => {
    const text = "a𠮷b";
    // "𠮷"（UTF-16で2単位）
    expect(selectionCells(text, { anchor: 1, focus: 3 })).toEqual({
      anchor: { x: 1, y: 0 },
      cursor: { x: 1, y: 0 },
    });
  });

  test("行末の改行まで選んだ終端は、その行の最後の文字へ寄せる", () => {
    const text = "abc\ndef";
    // トリプルクリックの行選択のように "abc\n" を選ぶ
    expect(selectionCells(text, { anchor: 0, focus: 4 })).toEqual({
      anchor: { x: 0, y: 0 },
      cursor: { x: 2, y: 0 },
    });
  });

  test("行末の改行から始まる始端は、次の行の頭へ寄せる", () => {
    const text = "abc\ndef";
    expect(selectionCells(text, { anchor: 3, focus: 6 })).toEqual({
      anchor: { x: 0, y: 1 },
      cursor: { x: 1, y: 1 },
    });
  });

  test("空の選択と、改行だけの選択はnull", () => {
    const text = "abc\ndef";
    expect(selectionCells(text, { anchor: 2, focus: 2 })).toBeNull();
    expect(selectionCells(text, { anchor: 3, focus: 4 })).toBeNull();
  });
});
