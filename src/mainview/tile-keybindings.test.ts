import { describe, expect, test } from "bun:test";
import {
  compileKeybindings,
  defaultKeybindings,
  defaultWindowsKeybindings,
} from "@niwaterm/config";
import { resolveTileCommand } from "./tile-keybindings";

const compiled = compileKeybindings(defaultKeybindings);

function key(
  k: string,
  opts: {
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    code?: string;
  } = {},
): Parameters<typeof resolveTileCommand>[0] {
  return {
    key: k,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...opts,
  };
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

  test("Cmd+Shift+T -> ブラウザタブ新規作成", () => {
    expect(resolveTileCommand(key("t", { metaKey: true, shiftKey: true }), compiled)).toEqual({
      type: "newBrowserTab",
    });
  });

  test("new-custom-view-tabはデフォルトでは何もキーに割り当てられていない（customView未設定時は無意味なため）", () => {
    const customCompiled = compileKeybindings({ "cmd+shift+u": "new-custom-view-tab" });
    expect(resolveTileCommand(key("u", { metaKey: true, shiftKey: true }), customCompiled)).toEqual(
      { type: "newCustomViewTab" },
    );
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

  test("Cmd+B -> サイドバートグル", () => {
    expect(resolveTileCommand(key("b", { metaKey: true }), compiled)).toEqual({
      type: "toggleSidebar",
    });
  });

  test("Cmd+Shift+B はデフォルトでは何も割り当てられていない", () => {
    expect(resolveTileCommand(key("b", { metaKey: true, shiftKey: true }), compiled)).toBeNull();
  });
});

describe("resolveTileCommand（Windowsのデフォルトキーバインド）", () => {
  const winCompiled = compileKeybindings(defaultWindowsKeybindings);

  test("Ctrl+Shift+D -> 垂直分割", () => {
    expect(resolveTileCommand(key("D", { ctrlKey: true, shiftKey: true }), winCompiled)).toEqual({
      type: "split",
      orientation: "vertical",
    });
  });

  test("Ctrl+Shift+E -> 水平分割", () => {
    expect(resolveTileCommand(key("E", { ctrlKey: true, shiftKey: true }), winCompiled)).toEqual({
      type: "split",
      orientation: "horizontal",
    });
  });

  test("Ctrl+Shift+Alt+T -> ブラウザタブ新規作成", () => {
    expect(
      resolveTileCommand(key("T", { ctrlKey: true, shiftKey: true, altKey: true }), winCompiled),
    ).toEqual({ type: "newBrowserTab" });
  });

  test("Ctrl+C はターミナルの制御文字なので何も割り当てられていない", () => {
    expect(resolveTileCommand(key("c", { ctrlKey: true }), winCompiled)).toBeNull();
  });

  test("Ctrl+Shift+C -> 選択テキストをコピー", () => {
    expect(resolveTileCommand(key("C", { ctrlKey: true, shiftKey: true }), winCompiled)).toEqual({
      type: "copySelection",
    });
  });

  test("Ctrl+Shift+V -> クリップボードから貼り付け", () => {
    expect(resolveTileCommand(key("V", { ctrlKey: true, shiftKey: true }), winCompiled)).toEqual({
      type: "pasteClipboard",
    });
  });

  test("Ctrl+D / Ctrl+B もターミナルへ素通りする", () => {
    expect(resolveTileCommand(key("d", { ctrlKey: true }), winCompiled)).toBeNull();
    expect(resolveTileCommand(key("b", { ctrlKey: true }), winCompiled)).toBeNull();
  });

  test("macOS用のCmd+Dはこのテーブルでは反応しない", () => {
    expect(resolveTileCommand(key("d", { metaKey: true }), winCompiled)).toBeNull();
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
