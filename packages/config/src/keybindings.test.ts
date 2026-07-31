import { describe, expect, test } from "bun:test";
import {
  canonicalizeParsed,
  compileKeybindings,
  defaultKeybindings,
  isKeybindAction,
  KEYBIND_ACTIONS,
  parseKeyBindingString,
} from "./keybindings";

describe("parseKeyBindingString", () => {
  test("cmd+key を解析できる", () => {
    expect(parseKeyBindingString("cmd+d")).toEqual({
      cmd: true,
      shift: false,
      alt: false,
      key: "d",
    });
  });

  test("cmd+shift+key を解析できる", () => {
    expect(parseKeyBindingString("cmd+shift+d")).toEqual({
      cmd: true,
      shift: true,
      alt: false,
      key: "d",
    });
  });

  test("cmd+alt+key を解析できる", () => {
    expect(parseKeyBindingString("cmd+alt+up")).toEqual({
      cmd: true,
      shift: false,
      alt: true,
      key: "up",
    });
  });

  test("大文字混じりも許容する", () => {
    expect(parseKeyBindingString("Cmd+Shift+D")).toEqual({
      cmd: true,
      shift: true,
      alt: false,
      key: "d",
    });
  });

  test("Cmdを含まない場合はnull", () => {
    expect(parseKeyBindingString("shift+d")).toBeNull();
  });

  test("未知の修飾子を含む場合はnull", () => {
    expect(parseKeyBindingString("ctrl+d")).toBeNull();
  });

  test("キー本体が無い場合はnull", () => {
    expect(parseKeyBindingString("cmd+")).toBeNull();
  });

  test("修飾子が無い単独キーはnull（Cmd必須のため）", () => {
    expect(parseKeyBindingString("d")).toBeNull();
  });
});

describe("canonicalizeParsed", () => {
  test("修飾子の有無とkeyから一意な文字列を生成する", () => {
    expect(canonicalizeParsed({ cmd: true, shift: false, alt: false, key: "d" })).toBe("100:d");
    expect(canonicalizeParsed({ cmd: true, shift: true, alt: false, key: "d" })).toBe("110:d");
    expect(canonicalizeParsed({ cmd: true, shift: false, alt: true, key: "up" })).toBe("101:up");
  });
});

describe("isKeybindAction", () => {
  test("KEYBIND_ACTIONSに含まれる文字列はtrue", () => {
    for (const action of KEYBIND_ACTIONS) {
      expect(isKeybindAction(action)).toBe(true);
    }
  });

  test("未知の文字列や非文字列はfalse", () => {
    expect(isKeybindAction("unknown-action")).toBe(false);
    expect(isKeybindAction(123)).toBe(false);
    expect(isKeybindAction(null)).toBe(false);
  });
});

describe("defaultKeybindings", () => {
  test("14個のアクション全てに1つずつ割り当てられている", () => {
    const actions = Object.values(defaultKeybindings);
    expect(actions.length).toBe(14);
    expect(new Set(actions).size).toBe(14);
    for (const action of KEYBIND_ACTIONS) {
      expect(actions).toContain(action);
    }
  });
});

describe("compileKeybindings", () => {
  test("正常なエントリはcanonicalizeされたキーでMapに入る", () => {
    const compiled = compileKeybindings({ "cmd+d": "split-vertical" });
    expect(compiled.get("100:d")).toBe("split-vertical");
    expect(compiled.size).toBe(1);
  });

  test("不正なバインド文字列は黙ってスキップされる", () => {
    const compiled = compileKeybindings({ "ctrl+d": "split-vertical" } as never);
    expect(compiled.size).toBe(0);
  });

  test("未知のアクション名は黙ってスキップされる", () => {
    const compiled = compileKeybindings({ "cmd+d": "not-a-real-action" } as never);
    expect(compiled.size).toBe(0);
  });

  test("defaultKeybindingsは14エントリ全てコンパイルできる", () => {
    const compiled = compileKeybindings(defaultKeybindings);
    expect(compiled.size).toBe(14);
  });
});
