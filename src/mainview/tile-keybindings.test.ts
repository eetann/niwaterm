import { describe, expect, test } from "bun:test";
import { resolveTileCommand } from "./tile-keybindings";

function key(
  k: string,
  opts: { metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
): Parameters<typeof resolveTileCommand>[0] {
  return { key: k, metaKey: false, altKey: false, shiftKey: false, ...opts };
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
});
