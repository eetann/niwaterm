import { describe, expect, test } from "bun:test";
import {
  canonicalizeParsed,
  canonicalizeSecondKey,
  compileKeybindings,
  defaultKeybindings,
  defaultWindowsKeybindings,
  isBindingTarget,
  isCustomBindingRef,
  isKeybindAction,
  KEYBIND_ACTIONS,
  parseKeyBindingString,
  parseSecondKeyString,
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

  test("ctrl+key を解析できる（prefixキーの既定形）", () => {
    expect(parseKeyBindingString("ctrl+b")).toEqual({
      cmd: false,
      ctrl: true,
      shift: false,
      alt: false,
      key: "b",
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

describe("parseSecondKeyString", () => {
  test("修飾子なしの単一キーを解析できる", () => {
    expect(parseSecondKeyString("d")).toEqual({ shift: false, alt: false, key: "d" });
  });

  test("shift+key を解析できる", () => {
    expect(parseSecondKeyString("shift+d")).toEqual({ shift: true, alt: false, key: "d" });
  });

  test("alt+key を解析できる", () => {
    expect(parseSecondKeyString("alt+d")).toEqual({ shift: false, alt: true, key: "d" });
  });

  test("shift+alt+key を解析できる", () => {
    expect(parseSecondKeyString("shift+alt+d")).toEqual({ shift: true, alt: true, key: "d" });
  });

  test("矢印キー・記号キーも解析できる", () => {
    expect(parseSecondKeyString("up")).toEqual({ shift: false, alt: false, key: "up" });
    expect(parseSecondKeyString("[")).toEqual({ shift: false, alt: false, key: "[" });
  });

  test("大文字混じりも許容する", () => {
    expect(parseSecondKeyString("Shift+D")).toEqual({ shift: true, alt: false, key: "d" });
  });

  test("cmd/ctrlを含む場合はnull（2打目はshift/altのみ許容）", () => {
    expect(parseSecondKeyString("cmd+d")).toBeNull();
    expect(parseSecondKeyString("ctrl+d")).toBeNull();
  });

  test("未知の修飾子を含む場合はnull", () => {
    expect(parseSecondKeyString("hyper+d")).toBeNull();
  });

  test("キー本体が無い場合はnull", () => {
    expect(parseSecondKeyString("shift+")).toBeNull();
  });
});

describe("canonicalizeSecondKey", () => {
  test("修飾子の有無とkeyから一意な文字列を生成する", () => {
    expect(canonicalizeSecondKey({ shift: false, alt: false, key: "d" })).toBe("00:d");
    expect(canonicalizeSecondKey({ shift: true, alt: false, key: "d" })).toBe("10:d");
    expect(canonicalizeSecondKey({ shift: false, alt: true, key: "d" })).toBe("01:d");
    expect(canonicalizeSecondKey({ shift: true, alt: true, key: "d" })).toBe("11:d");
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

// bindingsに既定キーを持たないアクション。理由はケースごとに異なる（下記テスト参照）
const UNASSIGNED_BINDING_ACTIONS = ["new-custom-view-tab", "copy-selection", "paste-clipboard"];

describe("defaultKeybindings", () => {
  test("prefixはCtrl+B（tmux標準）", () => {
    expect(defaultKeybindings.prefix).toBe("ctrl+b");
  });

  test("UNASSIGNED_BINDING_ACTIONS以外の24個のアクションに1つずつ割り当てられている", () => {
    const actions = Object.values(defaultKeybindings.bindings ?? {});
    expect(actions.length).toBe(24);
    expect(new Set(actions).size).toBe(24);
    for (const action of KEYBIND_ACTIONS) {
      if (UNASSIGNED_BINDING_ACTIONS.includes(action)) continue;
      expect(actions).toContain(action);
    }
  });

  test("new-custom-view-tabはcustomView未設定時に無意味なため既定キーを持たない（ユーザー設定での割り当てを想定）", () => {
    expect(Object.values(defaultKeybindings.bindings ?? {})).not.toContain("new-custom-view-tab");
  });

  test("copy-selection/paste-clipboardはCmd+C/VがApplicationMenu経由で既に機能するため既定キーを持たない", () => {
    expect(Object.values(defaultKeybindings.bindings ?? {})).not.toContain("copy-selection");
    expect(Object.values(defaultKeybindings.bindings ?? {})).not.toContain("paste-clipboard");
    expect(defaultKeybindings.direct ?? {}).toEqual({});
  });
});

describe("defaultWindowsKeybindings", () => {
  test("prefix・2打目キーの割り当てはmacOS版と共通（Ctrl+B）", () => {
    expect(defaultWindowsKeybindings.prefix).toBe("ctrl+b");
    expect(defaultWindowsKeybindings.bindings).toEqual(defaultKeybindings.bindings);
  });

  test("directにCtrl+Shift+C/Vでコピー・ペーストが割り当てられている", () => {
    expect(defaultWindowsKeybindings.direct).toEqual({
      "ctrl+shift+c": "copy-selection",
      "ctrl+shift+v": "paste-clipboard",
    });
  });

  test("directの全エントリがctrl始まりで、ターミナルの制御文字と衝突しないようshiftを伴う", () => {
    for (const binding of Object.keys(defaultWindowsKeybindings.direct ?? {})) {
      const parsed = parseKeyBindingString(binding);
      expect(parsed).not.toBeNull();
      expect(parsed?.ctrl).toBe(true);
      expect(parsed?.cmd).toBe(false);
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
  test("prefixはparseKeyBindingStringでパースされる", () => {
    const compiled = compileKeybindings({ prefix: "ctrl+b" });
    expect(compiled.prefix).toEqual({ cmd: false, ctrl: true, shift: false, alt: false, key: "b" });
  });

  test("prefix未指定はnull", () => {
    const compiled = compileKeybindings({});
    expect(compiled.prefix).toBeNull();
  });

  test("不正なprefix文字列はnull", () => {
    const compiled = compileKeybindings({ prefix: "hyper+b" as never });
    expect(compiled.prefix).toBeNull();
  });

  test("bindingsの正常なエントリはcanonicalizeSecondKeyされたキーでMapに入る", () => {
    const compiled = compileKeybindings({ bindings: { d: "split-vertical" } });
    expect(compiled.bindings.get("00:d")).toBe("split-vertical");
    expect(compiled.bindings.size).toBe(1);
  });

  test("bindingsの不正なバインド文字列は黙ってスキップされる", () => {
    const compiled = compileKeybindings({ bindings: { "cmd+d": "split-vertical" } as never });
    expect(compiled.bindings.size).toBe(0);
  });

  test("bindingsの未知のアクション名は黙ってスキップされる", () => {
    const compiled = compileKeybindings({ bindings: { d: "not-a-real-action" } as never });
    expect(compiled.bindings.size).toBe(0);
  });

  test("directの正常なエントリはcanonicalizeParsedされたキーでMapに入る", () => {
    const compiled = compileKeybindings({ direct: { "ctrl+shift+c": "copy-selection" } });
    expect(compiled.direct.get("0110:c")).toBe("copy-selection");
    expect(compiled.direct.size).toBe(1);
  });

  test("directの不正なバインド文字列は黙ってスキップされる", () => {
    const compiled = compileKeybindings({ direct: { d: "copy-selection" } as never });
    expect(compiled.direct.size).toBe(0);
  });

  test("defaultKeybindingsはprefix1件・bindings24件・directなしでコンパイルできる", () => {
    const compiled = compileKeybindings(defaultKeybindings);
    expect(compiled.prefix).not.toBeNull();
    expect(compiled.bindings.size).toBe(24);
    expect(compiled.direct.size).toBe(0);
  });

  test("defaultWindowsKeybindingsはprefix1件・bindings24件・direct2件でコンパイルできる", () => {
    const compiled = compileKeybindings(defaultWindowsKeybindings);
    expect(compiled.prefix).not.toBeNull();
    expect(compiled.bindings.size).toBe(24);
    expect(compiled.direct.size).toBe(2);
  });

  test("bindings/directのcustom BindingTarget（関数ハンドラ）はそのままMapに入る", () => {
    const compiled = compileKeybindings({
      bindings: { m: { kind: "custom", id: "handler-0" } },
      direct: { "cmd+shift+g": { kind: "custom", id: "handler-1" } },
    });
    expect(compiled.bindings.get("00:m")).toEqual({ kind: "custom", id: "handler-0" });
    expect(compiled.direct.get("1010:g")).toEqual({ kind: "custom", id: "handler-1" });
  });
});

describe("isCustomBindingRef", () => {
  test("kind:customのオブジェクトはtrue", () => {
    expect(isCustomBindingRef({ kind: "custom", id: "handler-0" })).toBe(true);
  });

  test("KeybindAction文字列・null・idが数値のオブジェクトはfalse", () => {
    expect(isCustomBindingRef("split-vertical")).toBe(false);
    expect(isCustomBindingRef(null)).toBe(false);
    expect(isCustomBindingRef({ kind: "custom", id: 1 })).toBe(false);
  });
});

describe("isBindingTarget", () => {
  test("KeybindAction文字列・CustomBindingRefはどちらもtrue", () => {
    expect(isBindingTarget("split-vertical")).toBe(true);
    expect(isBindingTarget({ kind: "custom", id: "handler-0" })).toBe(true);
  });

  test("未知の文字列・不正な形はfalse", () => {
    expect(isBindingTarget("not-a-real-action")).toBe(false);
    expect(isBindingTarget({ kind: "custom" })).toBe(false);
  });
});
