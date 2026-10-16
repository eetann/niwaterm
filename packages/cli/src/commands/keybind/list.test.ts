import { describe, expect, test } from "bun:test";
import type { KeybindEntry } from "../../ipc-client";
import { formatKeybindList } from "./list";

function entry(overrides: Partial<KeybindEntry> & { key: string }): KeybindEntry {
  return { action: "split-vertical", repeat: false, noPrefix: false, ...overrides };
}

describe("formatKeybindList", () => {
  test("prefixを前置したキー表記とアクション名を、prefix・directのグループ別に並べる", () => {
    const lines = formatKeybindList({
      ok: true,
      prefix: "ctrl+b",
      repeatTimeoutMs: 500,
      entries: [
        entry({ key: "d" }),
        entry({ key: "ctrl+shift+c", action: "copy-selection", noPrefix: true }),
      ],
    });
    expect(lines).toEqual([
      "prefix: ctrl+b (repeat-timeout: 500ms)",
      "",
      "[prefix]",
      "ctrl+b d      split-vertical",
      "",
      "[direct]",
      "ctrl+shift+c  copy-selection",
    ]);
  });

  test("コピーモードの表はprefixを前置せず、表ごとのグループに分けて並べる", () => {
    const lines = formatKeybindList({
      ok: true,
      prefix: "ctrl+b",
      repeatTimeoutMs: 500,
      entries: [
        entry({ key: "v", action: "copy-mode" }),
        entry({ key: "g g", action: "copy-top", noPrefix: true, mode: "copy" }),
        entry({ key: "enter", action: "copy-search-confirm", noPrefix: true, mode: "copy-search" }),
      ],
    });
    expect(lines).toEqual([
      "prefix: ctrl+b (repeat-timeout: 500ms)",
      "",
      "[prefix]",
      "ctrl+b v  copy-mode",
      "",
      "[copy-mode]",
      "g g       copy-top",
      "",
      "[copy-mode search]",
      "enter     copy-search-confirm",
    ]);
  });

  test("descriptionがあればアクション名（関数ハンドラのfunction含む）の代わりに表示する", () => {
    const lines = formatKeybindList({
      ok: true,
      prefix: "ctrl+b",
      repeatTimeoutMs: 500,
      entries: [
        entry({ key: "r", action: "function" }),
        entry({ key: "g", action: "function", description: "lazygitを開く" }),
        entry({ key: "w", action: "close-tile", description: "タイルを閉じる" }),
      ],
    });
    expect(lines.slice(2)).toEqual([
      "[prefix]",
      "ctrl+b r  function",
      "ctrl+b g  lazygitを開く",
      "ctrl+b w  タイルを閉じる",
    ]);
  });

  test("repeatなバインドには(repeat)を添える", () => {
    const lines = formatKeybindList({
      ok: true,
      prefix: "ctrl+b",
      repeatTimeoutMs: 500,
      entries: [entry({ key: "h", action: "resize-left", repeat: true })],
    });
    expect(lines.at(-1)).toBe("ctrl+b h  resize-left (repeat)");
  });

  test("prefix未設定なら注意書きを出し、キーはprefixを前置せずに表示する", () => {
    const lines = formatKeybindList({
      ok: true,
      prefix: null,
      repeatTimeoutMs: 500,
      entries: [entry({ key: "d" })],
    });
    expect(lines[0]).toBe("prefix: (未設定。prefixを介するバインドは発火しません)");
    expect(lines.at(-1)).toBe("d  split-vertical");
  });

  test("1件も無ければその旨を表示する", () => {
    const lines = formatKeybindList({
      ok: true,
      prefix: "ctrl+b",
      repeatTimeoutMs: 500,
      entries: [],
    });
    expect(lines).toEqual([
      "prefix: ctrl+b (repeat-timeout: 500ms)",
      "(キーバインドが設定されていません)",
    ]);
  });
});
