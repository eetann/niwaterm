import { describe, expect, test } from "bun:test";
import { resolveTileCommand } from "./tile-keybindings";

function key(
  k: string,
  opts: { metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; code?: string } = {},
): Parameters<typeof resolveTileCommand>[0] {
  return { key: k, code: "", metaKey: false, altKey: false, shiftKey: false, ...opts };
}

describe("resolveTileCommand", () => {
  test("Cmd+D -> 垂直分割", () => {
    expect(resolveTileCommand(key("d", { metaKey: true }))).toEqual({
      type: "split",
      orientation: "vertical",
    });
  });

  test("Cmd+Shift+D -> 水平分割", () => {
    expect(resolveTileCommand(key("D", { metaKey: true, shiftKey: true }))).toEqual({
      type: "split",
      orientation: "horizontal",
    });
  });

  test("Cmd+W -> タイルを閉じる", () => {
    expect(resolveTileCommand(key("w", { metaKey: true }))).toEqual({ type: "close" });
  });

  test("Cmd+Shift+W はタイル操作にしない（他の用途に譲る）", () => {
    expect(resolveTileCommand(key("w", { metaKey: true, shiftKey: true }))).toBeNull();
  });

  test.each([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
  ] as const)("Cmd+Option+%s -> フォーカス移動(%s)", (arrow, direction) => {
    expect(resolveTileCommand(key(arrow, { metaKey: true, altKey: true }))).toEqual({
      type: "focus",
      direction,
    });
  });

  test("Cmdなし矢印キーはnull（ターミナル入力に委ねる）", () => {
    expect(resolveTileCommand(key("ArrowUp"))).toBeNull();
  });

  test("Cmdのみで通常文字キーはnull", () => {
    expect(resolveTileCommand(key("a", { metaKey: true }))).toBeNull();
  });

  test("Option+矢印だがCmdなしはnull", () => {
    expect(resolveTileCommand(key("ArrowUp", { altKey: true }))).toBeNull();
  });

  test("Cmd+Optionでも矢印以外はnull", () => {
    expect(resolveTileCommand(key("d", { metaKey: true, altKey: true }))).toBeNull();
  });

  test("Cmd+T -> タブ新規作成", () => {
    expect(resolveTileCommand(key("t", { metaKey: true }))).toEqual({ type: "newTab" });
  });

  test("Cmd+Shift+T はタブ操作にしない（他の用途に譲る）", () => {
    expect(resolveTileCommand(key("t", { metaKey: true, shiftKey: true }))).toBeNull();
  });

  test("Cmd+Shift+] -> 次のタブへ切替", () => {
    expect(
      resolveTileCommand(key("}", { metaKey: true, shiftKey: true, code: "BracketRight" })),
    ).toEqual({ type: "cycleTab", delta: 1 });
  });

  test("Cmd+Shift+[ -> 前のタブへ切替", () => {
    expect(
      resolveTileCommand(key("{", { metaKey: true, shiftKey: true, code: "BracketLeft" })),
    ).toEqual({ type: "cycleTab", delta: -1 });
  });

  test("Shiftなしの Cmd+] / Cmd+[ はタブ操作にしない", () => {
    expect(resolveTileCommand(key("]", { metaKey: true, code: "BracketRight" }))).toBeNull();
    expect(resolveTileCommand(key("[", { metaKey: true, code: "BracketLeft" }))).toBeNull();
  });

  test("Cmd+N -> ワークスペース新規作成", () => {
    expect(resolveTileCommand(key("n", { metaKey: true }))).toEqual({ type: "newWorkspace" });
  });

  test("Cmd+Shift+N はワークスペース操作にしない（他の用途に譲る）", () => {
    expect(resolveTileCommand(key("n", { metaKey: true, shiftKey: true }))).toBeNull();
  });

  test("Cmd+Option+] -> 次のワークスペースへ切替", () => {
    expect(
      resolveTileCommand(key("]", { metaKey: true, altKey: true, code: "BracketRight" })),
    ).toEqual({ type: "switchWorkspace", delta: 1 });
  });

  test("Cmd+Option+[ -> 前のワークスペースへ切替", () => {
    expect(
      resolveTileCommand(key("[", { metaKey: true, altKey: true, code: "BracketLeft" })),
    ).toEqual({ type: "switchWorkspace", delta: -1 });
  });

  test("Optionなしの Cmd+Shift+]/[ はワークスペース操作にしない（タブ切替のまま）", () => {
    expect(
      resolveTileCommand(key("}", { metaKey: true, shiftKey: true, code: "BracketRight" })),
    ).toEqual({ type: "cycleTab", delta: 1 });
  });
});
