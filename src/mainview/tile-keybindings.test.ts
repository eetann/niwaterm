import { describe, expect, test } from "bun:test";
import { compileKeybindings, defaultKeybindings } from "niwaterm-config";
import { resolveTileCommand } from "./tile-keybindings";

const compiled = compileKeybindings(defaultKeybindings);

function key(
  k: string,
  opts: { metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; code?: string } = {},
): Parameters<typeof resolveTileCommand>[0] {
  return { key: k, code: "", metaKey: false, altKey: false, shiftKey: false, ...opts };
}

describe("resolveTileCommand（デフォルトキーバインド）", () => {
  test("Cmd+D -> 垂直分割", () => {
    expect(resolveTileCommand(key("d", { metaKey: true }), compiled)).toEqual({
      type: "split",
      orientation: "vertical",
    });
  });

  test("Cmd+Shift+D -> 水平分割", () => {
    expect(resolveTileCommand(key("D", { metaKey: true, shiftKey: true }), compiled)).toEqual({
      type: "split",
      orientation: "horizontal",
    });
  });

  test("Cmd+W -> タイルを閉じる", () => {
    expect(resolveTileCommand(key("w", { metaKey: true }), compiled)).toEqual({ type: "close" });
  });

  test("Cmd+Shift+W はデフォルトでは何も割り当てられていない", () => {
    expect(resolveTileCommand(key("w", { metaKey: true, shiftKey: true }), compiled)).toBeNull();
  });

  test.each([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
  ] as const)("Cmd+Option+%s -> フォーカス移動(%s)", (arrow, direction) => {
    expect(resolveTileCommand(key(arrow, { metaKey: true, altKey: true }), compiled)).toEqual({
      type: "focus",
      direction,
    });
  });

  test("Cmdなし矢印キーはnull（ターミナル入力に委ねる）", () => {
    expect(resolveTileCommand(key("ArrowUp"), compiled)).toBeNull();
  });

  test("Cmdのみで通常文字キーはnull", () => {
    expect(resolveTileCommand(key("a", { metaKey: true }), compiled)).toBeNull();
  });

  test("Option+矢印だがCmdなしはnull", () => {
    expect(resolveTileCommand(key("ArrowUp", { altKey: true }), compiled)).toBeNull();
  });

  test("Cmd+Optionでも矢印以外はデフォルトでは何も割り当てられていない", () => {
    expect(resolveTileCommand(key("d", { metaKey: true, altKey: true }), compiled)).toBeNull();
  });

  test("Cmd+T -> タブ新規作成", () => {
    expect(resolveTileCommand(key("t", { metaKey: true }), compiled)).toEqual({ type: "newTab" });
  });

  test("Cmd+Shift+T はデフォルトでは何も割り当てられていない", () => {
    expect(resolveTileCommand(key("t", { metaKey: true, shiftKey: true }), compiled)).toBeNull();
  });

  test("Cmd+Shift+] -> 次のタブへ切替", () => {
    expect(
      resolveTileCommand(
        key("}", { metaKey: true, shiftKey: true, code: "BracketRight" }),
        compiled,
      ),
    ).toEqual({ type: "cycleTab", delta: 1 });
  });

  test("Cmd+Shift+[ -> 前のタブへ切替", () => {
    expect(
      resolveTileCommand(
        key("{", { metaKey: true, shiftKey: true, code: "BracketLeft" }),
        compiled,
      ),
    ).toEqual({ type: "cycleTab", delta: -1 });
  });

  test("Shiftなしの Cmd+] / Cmd+[ はデフォルトでは何も割り当てられていない", () => {
    expect(
      resolveTileCommand(key("]", { metaKey: true, code: "BracketRight" }), compiled),
    ).toBeNull();
    expect(
      resolveTileCommand(key("[", { metaKey: true, code: "BracketLeft" }), compiled),
    ).toBeNull();
  });

  test("Cmd+N -> ワークスペース新規作成", () => {
    expect(resolveTileCommand(key("n", { metaKey: true }), compiled)).toEqual({
      type: "newWorkspace",
    });
  });

  test("Cmd+Shift+N はデフォルトでは何も割り当てられていない", () => {
    expect(resolveTileCommand(key("n", { metaKey: true, shiftKey: true }), compiled)).toBeNull();
  });

  test("Cmd+Option+] -> 次のワークスペースへ切替", () => {
    expect(
      resolveTileCommand(key("]", { metaKey: true, altKey: true, code: "BracketRight" }), compiled),
    ).toEqual({ type: "switchWorkspace", delta: 1 });
  });

  test("Cmd+Option+[ -> 前のワークスペースへ切替", () => {
    expect(
      resolveTileCommand(key("[", { metaKey: true, altKey: true, code: "BracketLeft" }), compiled),
    ).toEqual({ type: "switchWorkspace", delta: -1 });
  });

  test("Optionなしの Cmd+Shift+]/[ はワークスペース操作にしない（タブ切替のまま）", () => {
    expect(
      resolveTileCommand(
        key("}", { metaKey: true, shiftKey: true, code: "BracketRight" }),
        compiled,
      ),
    ).toEqual({ type: "cycleTab", delta: 1 });
  });
});

describe("resolveTileCommand（カスタムキーバインド）", () => {
  test("設定で上書きしたキーは新しいアクションに切り替わる", () => {
    const custom = compileKeybindings({ "cmd+d": "close-tile" });
    expect(resolveTileCommand(key("d", { metaKey: true }), custom)).toEqual({ type: "close" });
  });

  test("マージされていない単独テーブルでは他のキーはnullになる", () => {
    const custom = compileKeybindings({ "cmd+d": "close-tile" });
    expect(resolveTileCommand(key("w", { metaKey: true }), custom)).toBeNull();
  });
});
