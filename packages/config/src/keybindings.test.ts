import { describe, expect, test } from "bun:test";
import {
  canonicalizeParsed,
  compileKeybindings,
  defaultKeybindings,
  defaultWindowsKeybindings,
  isKeybindAction,
  KEYBIND_ACTIONS,
  parseKeyBindingString,
  platformDefaultKeybindings,
} from "./keybindings";

describe("parseKeyBindingString", () => {
  test("cmd+key を解析できる", () => {
    expect(parseKeyBindingString("cmd+d")).toEqual({
      cmd: true,
      ctrl: false,
      shift: false,
      alt: false,
      key: "d",
    });
  });

  test("cmd+shift+key を解析できる", () => {
    expect(parseKeyBindingString("cmd+shift+d")).toEqual({
      cmd: true,
      ctrl: false,
      shift: true,
      alt: false,
      key: "d",
    });
  });

  test("cmd+alt+key を解析できる", () => {
    expect(parseKeyBindingString("cmd+alt+up")).toEqual({
      cmd: true,
      ctrl: false,
      shift: false,
      alt: true,
      key: "up",
    });
  });

  test("ctrl+shift+key を解析できる（Windowsの既定形）", () => {
    expect(parseKeyBindingString("ctrl+shift+d")).toEqual({
      cmd: false,
      ctrl: true,
      shift: true,
      alt: false,
      key: "d",
    });
  });

  test("修飾子4つの組み合わせも解析できる", () => {
    expect(parseKeyBindingString("ctrl+shift+alt+t")).toEqual({
      cmd: false,
      ctrl: true,
      shift: true,
      alt: true,
      key: "t",
    });
  });

  test("大文字混じりも許容する", () => {
    expect(parseKeyBindingString("Cmd+Shift+D")).toEqual({
      cmd: true,
      ctrl: false,
      shift: true,
      alt: false,
      key: "d",
    });
  });

  test("cmdもctrlも含まない場合はnull", () => {
    expect(parseKeyBindingString("shift+d")).toBeNull();
    expect(parseKeyBindingString("alt+d")).toBeNull();
  });

  test("未知の修飾子を含む場合はnull", () => {
    expect(parseKeyBindingString("hyper+d")).toBeNull();
  });

  test("キー本体が無い場合はnull", () => {
    expect(parseKeyBindingString("cmd+")).toBeNull();
  });

  test("修飾子が無い単独キーはnull（cmdまたはctrl必須のため）", () => {
    expect(parseKeyBindingString("d")).toBeNull();
  });
});

describe("canonicalizeParsed", () => {
  test("修飾子の有無とkeyから一意な文字列を生成する", () => {
    const base = { cmd: false, ctrl: false, shift: false, alt: false };
    expect(canonicalizeParsed({ ...base, cmd: true, key: "d" })).toBe("1000:d");
    expect(canonicalizeParsed({ ...base, cmd: true, shift: true, key: "d" })).toBe("1010:d");
    expect(canonicalizeParsed({ ...base, cmd: true, alt: true, key: "up" })).toBe("1001:up");
    expect(canonicalizeParsed({ ...base, ctrl: true, shift: true, key: "d" })).toBe("0110:d");
  });

  test("cmdとctrlは区別される", () => {
    const base = { shift: false, alt: false, key: "d" };
    expect(canonicalizeParsed({ ...base, cmd: true, ctrl: false })).not.toBe(
      canonicalizeParsed({ ...base, cmd: false, ctrl: true }),
    );
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

// macOS側では既定キーを持たないアクション。理由はケースごとに異なる（下記テスト参照）
const MACOS_UNASSIGNED_ACTIONS = ["new-custom-view-tab", "copy-selection", "paste-clipboard"];

describe("defaultKeybindings", () => {
  test("MACOS_UNASSIGNED_ACTIONS以外の19個のアクションに1つずつ割り当てられている", () => {
    const actions = Object.values(defaultKeybindings);
    expect(actions.length).toBe(19);
    expect(new Set(actions).size).toBe(19);
    for (const action of KEYBIND_ACTIONS) {
      if (MACOS_UNASSIGNED_ACTIONS.includes(action)) continue;
      expect(actions).toContain(action);
    }
  });

  test("new-custom-view-tabはcustomView未設定時に無意味なため既定キーを持たない（ユーザー設定での割り当てを想定）", () => {
    expect(Object.values(defaultKeybindings)).not.toContain("new-custom-view-tab");
  });

  test("copy-selection/paste-clipboardはCmd+C/Cmd+VがApplicationMenu経由で既に機能するため既定キーを持たない", () => {
    expect(Object.values(defaultKeybindings)).not.toContain("copy-selection");
    expect(Object.values(defaultKeybindings)).not.toContain("paste-clipboard");
  });
});

describe("defaultWindowsKeybindings", () => {
  test("macOS版のアクション集合 + Windows専用のcopy-selection/paste-clipboardをカバーする", () => {
    const macActions = new Set(Object.values(defaultKeybindings));
    const winActions = new Set(Object.values(defaultWindowsKeybindings));
    expect(winActions).toEqual(new Set([...macActions, "copy-selection", "paste-clipboard"]));
  });

  test("全エントリがctrl始まりで、ターミナルの制御文字と衝突しないようshiftを伴う", () => {
    for (const binding of Object.keys(defaultWindowsKeybindings)) {
      const parsed = parseKeyBindingString(binding);
      expect(parsed).not.toBeNull();
      expect(parsed?.ctrl).toBe(true);
      expect(parsed?.cmd).toBe(false);
      // ctrl単独だとCtrl+C/Ctrl+D等を奪ってしまうため、shiftかaltを必ず伴わせる
      expect(parsed?.shift === true || parsed?.alt === true).toBe(true);
    }
  });
});

describe("platformDefaultKeybindings", () => {
  test("win32ではWindows用、それ以外はmacOS用を返す", () => {
    expect(platformDefaultKeybindings("win32")).toBe(defaultWindowsKeybindings);
    expect(platformDefaultKeybindings("darwin")).toBe(defaultKeybindings);
  });
});

describe("compileKeybindings", () => {
  test("正常なエントリはcanonicalizeされたキーでMapに入る", () => {
    const compiled = compileKeybindings({ "cmd+d": "split-vertical" });
    expect(compiled.get("1000:d")).toBe("split-vertical");
    expect(compiled.size).toBe(1);
  });

  test("不正なバインド文字列は黙ってスキップされる", () => {
    const compiled = compileKeybindings({ "hyper+d": "split-vertical" } as never);
    expect(compiled.size).toBe(0);
  });

  test("未知のアクション名は黙ってスキップされる", () => {
    const compiled = compileKeybindings({ "cmd+d": "not-a-real-action" } as never);
    expect(compiled.size).toBe(0);
  });

  test("defaultKeybindingsは19エントリ全てコンパイルできる", () => {
    const compiled = compileKeybindings(defaultKeybindings);
    expect(compiled.size).toBe(19);
  });

  test("defaultWindowsKeybindingsは21エントリ全てコンパイルできる", () => {
    const compiled = compileKeybindings(defaultWindowsKeybindings);
    expect(compiled.size).toBe(21);
  });
});
