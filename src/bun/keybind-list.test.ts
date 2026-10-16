import { describe, expect, test } from "bun:test";
import type { KeybindingsConfig } from "@niwaterm/config";
import { buildKeybindList } from "./keybind-list";

describe("buildKeybindList", () => {
  test("prefix・repeatTimeoutMsをそのまま返す", () => {
    const info = buildKeybindList({ prefix: "ctrl+b", repeatTimeoutMs: 300 });
    expect(info.prefix).toBe("ctrl+b");
    expect(info.repeatTimeoutMs).toBe(300);
  });

  test("prefix未設定・不正な表記はnull、repeatTimeoutMs未設定は既定値500になる", () => {
    expect(buildKeybindList({}).prefix).toBeNull();
    expect(buildKeybindList({}).repeatTimeoutMs).toBe(500);
    // cmd/ctrl/altのいずれも含まないprefixはcompileKeybindings側でも無効になる
    expect(buildKeybindList({ prefix: "shift+b" as "ctrl+b" }).prefix).toBeNull();
  });

  test("bindingsはnoPrefix:false、directはnoPrefix:trueで、prefix側→direct側の順に並ぶ", () => {
    const config: KeybindingsConfig = {
      prefix: "ctrl+b",
      bindings: { d: "split-vertical" },
      direct: { "ctrl+shift+c": "copy-selection" },
    };
    expect(buildKeybindList(config).entries).toEqual([
      {
        key: "d",
        action: "split-vertical",
        description: undefined,
        repeat: false,
        noPrefix: false,
      },
      {
        key: "ctrl+shift+c",
        action: "copy-selection",
        description: undefined,
        repeat: false,
        noPrefix: true,
      },
    ]);
  });

  test("コピーモードの表はmode付きでdirect側の後に並び、不正なエントリは除外する", () => {
    const config: KeybindingsConfig = {
      copyMode: {
        "g g": "copy-top",
        x: { kind: "custom", id: "handler-0" },
        z: "split-vertical" as never,
      },
      copyModeSearch: { enter: "copy-search-confirm", "a b": "copy-search-clear" },
    };
    expect(buildKeybindList(config).entries).toEqual([
      {
        key: "g g",
        action: "copy-top",
        description: undefined,
        repeat: false,
        noPrefix: true,
        mode: "copy",
      },
      {
        key: "x",
        action: "function",
        description: undefined,
        repeat: false,
        noPrefix: true,
        mode: "copy",
      },
      {
        key: "enter",
        action: "copy-search-confirm",
        description: undefined,
        repeat: false,
        noPrefix: true,
        mode: "copy-search",
      },
    ]);
  });

  test("グループ内はキー表記順に並ぶ（登録順・数字キーの並びに引きずられない）", () => {
    const config: KeybindingsConfig = {
      bindings: { z: "toggle-zoom", "0": "reset-font-size", d: "split-vertical" },
    };
    expect(buildKeybindList(config).entries.map((e) => e.key)).toEqual(["0", "d", "z"]);
  });

  test("関数ハンドラのactionはfunction、descriptionはそのまま返す", () => {
    const config: KeybindingsConfig = {
      bindings: {
        r: { target: { kind: "custom", id: "handler-0" } },
        g: { target: { kind: "custom", id: "handler-1" }, description: "gitのブランチを選ぶ" },
      },
    };
    const entries = buildKeybindList(config).entries;
    expect(entries.find((e) => e.key === "r")).toMatchObject({
      action: "function",
      description: undefined,
    });
    expect(entries.find((e) => e.key === "g")).toMatchObject({
      action: "function",
      description: "gitのブランチを選ぶ",
    });
  });

  test("repeat:trueはそのまま返す", () => {
    const config: KeybindingsConfig = { bindings: { h: { target: "resize-left", repeat: true } } };
    expect(buildKeybindList(config).entries[0]?.repeat).toBe(true);
  });

  test("実際には発火しないエントリ（キー表記・アクション名が不正）は除外する", () => {
    const config: KeybindingsConfig = {
      // 2打目キーにcmd/ctrlは使えず、directには修飾子必須
      bindings: { "ctrl+x": "split-vertical", d: "not-a-real-action" as "split-vertical" },
      direct: { d: "copy-selection" as "ctrl+c" },
    };
    expect(buildKeybindList(config).entries).toEqual([]);
  });
});
