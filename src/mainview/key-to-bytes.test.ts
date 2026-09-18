import { describe, expect, test } from "bun:test";
import { type KeyboardEventLike, keyToBytes } from "./key-to-bytes";

function ev(key: string, mods: Partial<Omit<KeyboardEventLike, "key">> = {}): KeyboardEventLike {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  };
}

describe("keyToBytes", () => {
  test.each([
    ["Enter", "\r"],
    ["Backspace", "\x7f"],
    ["Tab", "\t"],
    ["Escape", "\x1b"],
    ["ArrowUp", "\x1b[A"],
    ["ArrowDown", "\x1b[B"],
    ["ArrowRight", "\x1b[C"],
    ["ArrowLeft", "\x1b[D"],
    ["Home", "\x1b[H"],
    ["End", "\x1b[F"],
    ["Delete", "\x1b[3~"],
    ["PageUp", "\x1b[5~"],
    ["PageDown", "\x1b[6~"],
  ])("特殊キー %s -> %p", (key, expected) => {
    expect(keyToBytes(ev(key))).toBe(expected);
  });

  test("metaKey押下時は通常キーでもnull", () => {
    expect(keyToBytes(ev("a", { metaKey: true }))).toBeNull();
  });

  test("metaKey押下時は特殊キーでもnull（metaKey判定が先に効く）", () => {
    expect(keyToBytes(ev("Enter", { metaKey: true }))).toBeNull();
  });

  test.each([
    ["@", "\x00", "code=64、下限境界ちょうど"],
    ["a", "\x01", "代表例"],
    ["z", "\x1a", "代表例（SIGTSTP相当）"],
  ])("Ctrl+%s -> %p (%s)", (key, expected) => {
    expect(keyToBytes(ev(key, { ctrlKey: true }))).toBe(expected);
  });

  test("Ctrl+/ はcode=47<64のためnull", () => {
    expect(keyToBytes(ev("/", { ctrlKey: true }))).toBeNull();
  });

  test("Ctrl+ñ はtoUpperCase後code>=128のためnull", () => {
    expect(keyToBytes(ev("ñ", { ctrlKey: true }))).toBeNull();
  });

  test.each([
    ["a", "a"],
    ["1", "1"],
    [" ", " "],
  ])("通常の1文字入力 %p -> %p", (key, expected) => {
    expect(keyToBytes(ev(key))).toBe(expected);
  });

  test.each([["Shift"], ["F1"], ["CapsLock"]])("非対応の特殊キー名 %s -> null", (key) => {
    expect(keyToBytes(ev(key))).toBeNull();
  });

  describe("修飾キー付きの特殊キー（xtermのCSIパラメータ）", () => {
    test.each([
      ["ArrowUp", { altKey: true }, "\x1b[1;3A"],
      ["ArrowDown", { altKey: true }, "\x1b[1;3B"],
      ["ArrowRight", { shiftKey: true }, "\x1b[1;2C"],
      ["ArrowLeft", { ctrlKey: true }, "\x1b[1;5D"],
      ["ArrowUp", { ctrlKey: true, shiftKey: true }, "\x1b[1;6A"],
      ["ArrowRight", { ctrlKey: true, altKey: true, shiftKey: true }, "\x1b[1;8C"],
      ["Home", { ctrlKey: true }, "\x1b[1;5H"],
      ["End", { altKey: true }, "\x1b[1;3F"],
    ] as const)("%s + %o -> %p", (key, mods, expected) => {
      expect(keyToBytes(ev(key, mods))).toBe(expected);
    });

    test.each([
      ["Delete", { ctrlKey: true }, "\x1b[3;5~"],
      ["PageUp", { shiftKey: true }, "\x1b[5;2~"],
      ["PageDown", { altKey: true }, "\x1b[6;3~"],
    ] as const)("%s + %o -> %p", (key, mods, expected) => {
      expect(keyToBytes(ev(key, mods))).toBe(expected);
    });
  });

  describe("Alt（Meta）付きの入力", () => {
    test.each([
      ["b", "\x1bb"],
      ["f", "\x1bf"],
      [".", "\x1b."],
    ])("Alt+%p -> %p", (key, expected) => {
      expect(keyToBytes(ev(key, { altKey: true }))).toBe(expected);
    });

    test("macOSのOption入力で化けた非ASCII文字はプレフィックスを付けずそのまま送る", () => {
      expect(keyToBytes(ev("π", { altKey: true }))).toBe("π");
    });

    test("Ctrl+Alt+a はESC + 制御文字", () => {
      expect(keyToBytes(ev("a", { ctrlKey: true, altKey: true }))).toBe("\x1b\x01");
    });

    test.each([
      ["Enter", "\x1b\r"],
      ["Backspace", "\x1b\x7f"],
      ["Tab", "\x1b\t"],
    ])("Alt+%s -> %p", (key, expected) => {
      expect(keyToBytes(ev(key, { altKey: true }))).toBe(expected);
    });
  });

  test("Shift+Tab はバックタブ", () => {
    expect(keyToBytes(ev("Tab", { shiftKey: true }))).toBe("\x1b[Z");
  });
});
