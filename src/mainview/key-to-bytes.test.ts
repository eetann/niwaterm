import { describe, expect, test } from "bun:test";
import { keyToBytes } from "./key-to-bytes";

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
    expect(keyToBytes({ key, ctrlKey: false, metaKey: false })).toBe(expected);
  });

  test("metaKey押下時は通常キーでもnull", () => {
    expect(keyToBytes({ key: "a", ctrlKey: false, metaKey: true })).toBeNull();
  });

  test("metaKey押下時は特殊キーでもnull（metaKey判定が先に効く）", () => {
    expect(keyToBytes({ key: "Enter", ctrlKey: false, metaKey: true })).toBeNull();
  });

  test.each([
    ["@", "\x00", "code=64、下限境界ちょうど"],
    ["a", "\x01", "代表例"],
    ["z", "\x1a", "代表例（SIGTSTP相当）"],
  ])("Ctrl+%s -> %p (%s)", (key, expected) => {
    expect(keyToBytes({ key, ctrlKey: true, metaKey: false })).toBe(expected);
  });

  test("Ctrl+/ はcode=47<64のためnull", () => {
    expect(keyToBytes({ key: "/", ctrlKey: true, metaKey: false })).toBeNull();
  });

  test("Ctrl+ñ はtoUpperCase後code>=128のためnull", () => {
    expect(keyToBytes({ key: "ñ", ctrlKey: true, metaKey: false })).toBeNull();
  });

  test.each([
    ["a", "a"],
    ["1", "1"],
    [" ", " "],
  ])("通常の1文字入力 %p -> %p", (key, expected) => {
    expect(keyToBytes({ key, ctrlKey: false, metaKey: false })).toBe(expected);
  });

  test.each([["Shift"], ["F1"], ["CapsLock"]])("非対応の特殊キー名 %s -> null", (key) => {
    expect(keyToBytes({ key, ctrlKey: false, metaKey: false })).toBeNull();
  });
});
