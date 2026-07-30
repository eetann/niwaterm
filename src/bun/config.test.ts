import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAppearance, defaultKeybindings } from "@niwaterm/config";
import { configFilePath, loadUserConfig, resolveAppearance, resolveKeybindings } from "./config";

describe("configFilePath", () => {
  test(".config/niwaterm/niwaterm.config.ts を指す", () => {
    expect(configFilePath()).toMatch(/\.config\/niwaterm\/niwaterm\.config\.ts$/);
  });
});

describe("loadUserConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-config-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("ファイルが存在しない場合はnullを返す", async () => {
    expect(await loadUserConfig(join(dir, "not-found.config.ts"))).toBeNull();
  });

  test("export defaultされたオブジェクトを読み込める", async () => {
    const path = join(dir, "valid.config.ts");
    await writeFile(path, `export default { keybindings: { "cmd+d": "close-tile" } };\n`);
    expect(await loadUserConfig(path)).toEqual({ keybindings: { "cmd+d": "close-tile" } });
  });

  test("構文エラーの場合はnullを返し、理由をログ出力する", async () => {
    const path = join(dir, "broken.config.ts");
    await writeFile(path, "export default { this is not valid typescript ;;;\n");
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await loadUserConfig(path)).toBeNull();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("keybindings以外の形（配列やnull）の場合はnullを返す", async () => {
    const path = join(dir, "invalid-shape.config.ts");
    await writeFile(path, "export default { keybindings: null };\n");
    expect(await loadUserConfig(path)).toBeNull();
  });

  test("appearance以外の形（配列やnull）の場合はnullを返す", async () => {
    const path = join(dir, "invalid-appearance-shape.config.ts");
    await writeFile(path, "export default { appearance: null };\n");
    expect(await loadUserConfig(path)).toBeNull();
  });

  test("同一パスへの2回目の読み込みでも、ファイルが更新されていれば最新の内容を返す（キャッシュバスティング）", async () => {
    const path = join(dir, "hot-reload.config.ts");
    await writeFile(path, `export default { keybindings: { "cmd+d": "close-tile" } };\n`);
    expect(await loadUserConfig(path)).toEqual({ keybindings: { "cmd+d": "close-tile" } });
    await writeFile(path, `export default { keybindings: { "cmd+d": "new-tab" } };\n`);
    expect(await loadUserConfig(path)).toEqual({ keybindings: { "cmd+d": "new-tab" } });
  });
});

describe("resolveKeybindings", () => {
  test("nullを渡すとdefaultKeybindingsがそのまま返る", () => {
    const resolved = resolveKeybindings(null);
    expect(Object.keys(resolved).length).toBe(Object.keys(defaultKeybindings).length);
  });

  test("ユーザー設定で一部のキーを上書きできる", () => {
    const resolved = resolveKeybindings({ keybindings: { "cmd+d": "close-tile" } });
    expect(resolved["cmd+d"]).toBe("close-tile");
    // 上書きしていないキーはデフォルトのまま
    expect(resolved["cmd+w"]).toBe("close-tile");
  });

  test("不正なバインド文字列・未知のアクション名のエントリだけ除外し、残りは有効にする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveKeybindings({
        keybindings: {
          "ctrl+d": "close-tile",
          "cmd+z": "not-a-real-action",
        } as never,
      });
      expect(resolved["ctrl+d" as never]).toBeUndefined();
      expect(resolved["cmd+z" as never]).toBeUndefined();
      // defaultKeybindingsの13エントリは影響を受けず残っている
      expect(Object.keys(resolved).length).toBe(Object.keys(defaultKeybindings).length);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveAppearance", () => {
  test("nullを渡すとdefaultAppearanceがそのまま返る", () => {
    expect(resolveAppearance(null)).toEqual(defaultAppearance);
  });

  test("フィールドごとに部分上書きできる", () => {
    const resolved = resolveAppearance({ appearance: { fontSize: 20, foreground: "#00ff00" } });
    expect(resolved.fontSize).toBe(20);
    expect(resolved.foreground).toBe("#00ff00");
    // 上書きしていないフィールドはデフォルトのまま
    expect(resolved.background).toBe(defaultAppearance.background);
    expect(resolved.fontFamily).toBe(defaultAppearance.fontFamily);
  });

  test("不正な型のフィールドは警告付きでデフォルトにフォールバックする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveAppearance({
        appearance: { fontSize: "big" as never, foreground: "" },
      });
      expect(resolved.fontSize).toBe(defaultAppearance.fontSize);
      expect(resolved.foreground).toBe(defaultAppearance.foreground);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("ansiColorsはindex単位でマージし、不正値はそのindexだけデフォルトに戻す", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveAppearance({
        appearance: { ansiColors: ["#111111", "", "#333333"] as never },
      });
      expect(resolved.ansiColors[0]).toBe("#111111");
      expect(resolved.ansiColors[1]).toBe(defaultAppearance.ansiColors[1]);
      expect(resolved.ansiColors[2]).toBe("#333333");
      expect(resolved.ansiColors.length).toBe(16);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
