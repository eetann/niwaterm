import { describe, expect, test } from "bun:test";
import {
  compileCopyModeKeymap,
  isValidCopyModeKey,
  parseCopyModeKeySequence,
} from "./copy-mode-keybindings";
import { defaultKeybindings, defaultWindowsKeybindings } from "./keybindings";

describe("parseCopyModeKeySequence", () => {
  test("修飾なし・ctrl付きの1打をcanonical表記にする", () => {
    expect(parseCopyModeKeySequence("j")).toEqual(["0000:j"]);
    expect(parseCopyModeKeySequence("Ctrl+U")).toEqual(["0100:u"]);
    expect(parseCopyModeKeySequence("shift+g")).toEqual(["0010:g"]);
  });

  test("空白区切りは連続キーになる", () => {
    expect(parseCopyModeKeySequence("g g")).toEqual(["0000:g", "0000:g"]);
    expect(parseCopyModeKeySequence("space  ctrl+l")).toEqual(["0000:space", "0100:l"]);
  });

  test("未知の修飾子・空の表記はnull", () => {
    expect(parseCopyModeKeySequence("hyper+j")).toBeNull();
    expect(parseCopyModeKeySequence("")).toBeNull();
    expect(parseCopyModeKeySequence("ctrl+")).toBeNull();
  });
});

describe("isValidCopyModeKey", () => {
  test("検索入力中の表だけは連続キーを受け付けない", () => {
    expect(isValidCopyModeKey("g g", "copy")).toBe(true);
    expect(isValidCopyModeKey("g g", "copy-search")).toBe(false);
    expect(isValidCopyModeKey("enter", "copy-search")).toBe(true);
  });
});

describe("compileCopyModeKeymap", () => {
  test("連続キーの途中までの列を待ち受け用に集める", () => {
    const keymap = compileCopyModeKeymap({ copyMode: { "a b c": "copy-top" } });
    expect([...keymap.normal.pendingPrefixes]).toEqual(["0000:a", "0000:a 0000:b"]);
    expect(keymap.normal.bindings.get("0000:a 0000:b 0000:c")).toEqual({ target: "copy-top" });
  });

  test("表に無いアクション名・検索入力中の連続キーは黙って落とす", () => {
    const keymap = compileCopyModeKeymap({
      copyMode: { x: "split-vertical" as never },
      copyModeSearch: { "a b": "copy-search-confirm", y: "copy-top" as never },
    });
    expect(keymap.normal.bindings.size).toBe(0);
    expect(keymap.search.bindings.size).toBe(0);
  });

  test("既定の表はOS共通で、どのエントリも有効", () => {
    expect(defaultWindowsKeybindings.copyMode).toBe(defaultKeybindings.copyMode);
    const keymap = compileCopyModeKeymap(defaultKeybindings);
    expect(keymap.normal.bindings.size).toBe(Object.keys(defaultKeybindings.copyMode ?? {}).length);
    expect(keymap.search.bindings.size).toBe(
      Object.keys(defaultKeybindings.copyModeSearch ?? {}).length,
    );
  });
});
