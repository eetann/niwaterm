import { describe, expect, test } from "bun:test";
import { tmuxKeyToBytes, tmuxKeysToBytes } from "./tmux-keys";

describe("tmuxKeyToBytes", () => {
  test("特殊キー名でないトークンはリテラルとしてそのまま返る", () => {
    expect(tmuxKeyToBytes("ls -la")).toBe("ls -la");
  });

  test.each([
    ["Enter", "\r"],
    ["Escape", "\x1b"],
    ["Tab", "\t"],
    ["Space", " "],
    ["BSpace", "\x7f"],
    ["Up", "\x1b[A"],
    ["Down", "\x1b[B"],
    ["Left", "\x1b[D"],
    ["Right", "\x1b[C"],
    ["Home", "\x1b[H"],
    ["End", "\x1b[F"],
    ["Delete", "\x1b[3~"],
    ["PageUp", "\x1b[5~"],
    ["PageDown", "\x1b[6~"],
  ])("特殊キー名 %s は %j に変換される", (input, expected) => {
    expect(tmuxKeyToBytes(input)).toBe(expected);
  });

  test.each([
    ["C-a", "\x01"],
    ["C-c", "\x03"],
    ["C-z", "\x1a"],
    ["C-]", "\x1d"],
    ["C-[", "\x1b"],
    ["C-\\", "\x1c"],
    ["C-_", "\x1f"],
  ])("Ctrl+英字・記号 %s は制御バイトに変換される", (input, expected) => {
    expect(tmuxKeyToBytes(input)).toBe(expected);
  });

  test.each([
    ["C-End", "\x1b[1;5F"],
    ["C-Home", "\x1b[1;5H"],
    ["S-Up", "\x1b[1;2A"],
    ["M-Left", "\x1b[1;3D"],
    ["C-S-Right", "\x1b[1;6C"],
    ["C-PageDown", "\x1b[6;5~"],
    ["M-Delete", "\x1b[3;3~"],
  ])("修飾付きのカーソル系キー %s はxtermの修飾パラメータ付きで %j になる", (input, expected) => {
    expect(tmuxKeyToBytes(input)).toBe(expected);
  });

  test("未知のC-トークン・キー名らしき文字列はリテラル扱いになる", () => {
    expect(tmuxKeyToBytes("C-1")).toBe("C-1");
    expect(tmuxKeyToBytes("Foo")).toBe("Foo");
  });
});

describe("tmuxKeysToBytes", () => {
  test("複数トークンを結合したバイト列を返す", () => {
    expect(tmuxKeysToBytes(["ls -la", "Enter"])).toBe("ls -la\r");
  });
});
