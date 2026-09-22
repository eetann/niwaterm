import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultAppearance,
  defaultBoardConfig,
  defaultBrowserConfig,
  defaultMouseConfig,
  platformDefaultKeybindings,
} from "@niwaterm/config";
import {
  configDirPath,
  configFilePath,
  loadUserConfig,
  resolveAppearance,
  resolveBoard,
  resolveBrowser,
  resolveCustomView,
  resolveKeybindings,
  resolveLayouts,
  resolveMouse,
  resolveSelectionMenu,
  resolveShell,
  resolveShellProfiles,
  resolveWorkspaceDefaultCwd,
} from "./config";
import { createNiwaApi, type NiwaApiHandle } from "./niwa-api";
import type { TerminalSession } from "./terminal-session";
import { createWorkspaceManager } from "./workspace-manager";

// resolveKeybindingsはniwa.tile/tab等がworkspaceManagerを操作できる必要があるため、
// 検証用の最小限のworkspaceManager（PTYを実際には起動しないfakeセッション）で作る
function createTestNiwaApi(): NiwaApiHandle {
  const fakeSession: TerminalSession = {
    write: () => {},
    paste: () => {},
    mouseEvent: () => {},
    resize: () => false,
    setCellSize: () => {},
    scroll: () => {},
    scrollToTop: () => {},
    scrollToBottom: () => {},
    renderState: () => ({
      kind: "terminal",
      html: "",
      cursorX: 0,
      cursorY: 0,
      cursorVisible: true,
      cursorShape: "block",
      viewportPinned: true,
      mouseTracking: false,
      mouseAnyMotion: false,
    }),
    dumpText: () => "",
    setCallbacks: () => {},
    dispose: () => {},
  };
  const workspaceManager = createWorkspaceManager({
    initialCols: 80,
    initialRows: 24,
    onDirty: () => {},
    onAllWorkspacesClosed: () => {},
    createSession: () => fakeSession,
  });
  return createNiwaApi({
    workspaceManager,
    getShellProfiles: () => [],
    getShellRunEnv: () => ({}),
    getDefaultShell: () => undefined,
    sendNotification: () => {},
    reloadConfig: async () => {},
  });
}

describe("configFilePath", () => {
  test(".config/niwaterm/niwaterm.config.ts を指す", () => {
    // Windowsは区切りが \ になるため正規化してから比較する
    expect(configFilePath().replaceAll("\\", "/")).toMatch(
      /\.config\/niwaterm\/niwaterm\.config\.ts$/,
    );
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
    await writeFile(
      path,
      `export default { keybindings: { prefix: "ctrl+b", bindings: { d: "close-tile" } } };\n`,
    );
    expect(await loadUserConfig(path)).toEqual({
      keybindings: { prefix: "ctrl+b", bindings: { d: "close-tile" } },
    });
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

  test("keybindingsが関数（KeybindingsFn）の場合も読み込める", async () => {
    const path = join(dir, "fn-keybindings.config.ts");
    await writeFile(
      path,
      `export default { keybindings: (niwa) => { niwa.keybind("d", "close-tile"); } };\n`,
    );
    const loaded = await loadUserConfig(path);
    expect(typeof loaded?.keybindings).toBe("function");
  });

  test("appearance以外の形（配列やnull）の場合はnullを返す", async () => {
    const path = join(dir, "invalid-appearance-shape.config.ts");
    await writeFile(path, "export default { appearance: null };\n");
    expect(await loadUserConfig(path)).toBeNull();
  });

  test("browser以外の形（配列やnull）の場合はnullを返す", async () => {
    const path = join(dir, "invalid-browser-shape.config.ts");
    await writeFile(path, "export default { browser: null };\n");
    expect(await loadUserConfig(path)).toBeNull();
  });

  test("mouse以外の形（配列やnull）の場合はnullを返す", async () => {
    const path = join(dir, "invalid-mouse-shape.config.ts");
    await writeFile(path, "export default { mouse: null };\n");
    expect(await loadUserConfig(path)).toBeNull();
  });

  test("shell以外の形（配列やnull）の場合はnullを返す", async () => {
    const path = join(dir, "invalid-shell-shape.config.ts");
    await writeFile(path, "export default { shell: null };\n");
    expect(await loadUserConfig(path)).toBeNull();
  });

  test("同一パスへの2回目の読み込みでも、ファイルが更新されていれば最新の内容を返す（キャッシュバスティング）", async () => {
    const path = join(dir, "hot-reload.config.ts");
    await writeFile(path, `export default { keybindings: { bindings: { d: "close-tile" } } };\n`);
    expect(await loadUserConfig(path)).toEqual({ keybindings: { bindings: { d: "close-tile" } } });
    await writeFile(path, `export default { keybindings: { bindings: { d: "new-tab" } } };\n`);
    expect(await loadUserConfig(path)).toEqual({ keybindings: { bindings: { d: "new-tab" } } });
  });

  test("複数ファイル分割: エントリがimportする非エントリファイルの更新も2回目の読み込みで反映される", async () => {
    const entryPath = join(dir, "niwaterm.config.ts");
    const fontPath = join(dir, "font.ts");
    await writeFile(fontPath, "export const fontSize = 14;\n");
    await writeFile(
      entryPath,
      `import { fontSize } from "./font";\nexport default { appearance: { fontSize } };\n`,
    );
    expect(await loadUserConfig(entryPath)).toEqual({ appearance: { fontSize: 14 } });

    await writeFile(fontPath, "export const fontSize = 20;\n");
    expect(await loadUserConfig(entryPath)).toEqual({ appearance: { fontSize: 20 } });
  });

  test("複数ファイル分割: サブディレクトリ配置の非エントリファイルも解決できる", async () => {
    const entryPath = join(dir, "niwaterm.config.ts");
    await mkdir(join(dir, "keys"), { recursive: true });
    const keysPath = join(dir, "keys", "vim.ts");
    await writeFile(
      keysPath,
      `export function applyVimKeys(niwa) { niwa.keybind("d", "close-tile"); }\n`,
    );
    await writeFile(
      entryPath,
      `import { applyVimKeys } from "./keys/vim";\nexport default { keybindings: applyVimKeys };\n`,
    );
    const loaded = await loadUserConfig(entryPath);
    expect(typeof loaded?.keybindings).toBe("function");
  });

  test("node_modules配下のパッケージimportはシンボリックリンク越しに解決できる（@niwaterm/config相当）", async () => {
    const entryPath = join(dir, "niwaterm.config.ts");
    const pkgDir = join(dir, "node_modules", "fake-pkg");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "fake-pkg", main: "index.ts" }),
    );
    await writeFile(join(pkgDir, "index.ts"), "export const fontSize = 18;\n");
    await writeFile(
      entryPath,
      `import { fontSize } from "fake-pkg";\nexport default { appearance: { fontSize } };\n`,
    );
    expect(await loadUserConfig(entryPath)).toEqual({ appearance: { fontSize: 18 } });
  });

  test("エントリファイル自体がシンボリックリンクでも解決できる（dotfiles管理でniwaterm.config.ts等をリンクしている場合）", async () => {
    const realPath = join(dir, "real.config.ts");
    const entryPath = join(dir, "niwaterm.config.ts");
    await writeFile(realPath, `export default { appearance: { fontSize: 22 } };\n`);
    await symlink(realPath, entryPath);
    expect(await loadUserConfig(entryPath)).toEqual({ appearance: { fontSize: 22 } });
  });
});

describe("resolveKeybindings", () => {
  // prefix・bindingsはOS共通（既定Ctrl+B）、directのみOS別（Windowsのみコピー・ペースト）
  const platformDefaults = platformDefaultKeybindings(process.platform);

  test("nullを渡すとプラットフォームのデフォルトがそのまま返る", () => {
    const resolved = resolveKeybindings(null, createTestNiwaApi());
    expect(resolved.prefix).toBe(platformDefaults.prefix);
    expect(resolved.bindings).toEqual(platformDefaults.bindings ?? {});
    expect(resolved.direct).toEqual(platformDefaults.direct ?? {});
  });

  test("ユーザー設定でprefixを上書きできる", () => {
    const resolved = resolveKeybindings({ keybindings: { prefix: "cmd+j" } }, createTestNiwaApi());
    expect(resolved.prefix).toBe("cmd+j");
    // bindingsはデフォルトのまま
    expect(resolved.bindings).toEqual(platformDefaults.bindings ?? {});
  });

  test("不正なprefixは警告付きでデフォルトにフォールバックする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveKeybindings(
        { keybindings: { prefix: "hyper+b" as never } },
        createTestNiwaApi(),
      );
      expect(resolved.prefix).toBe(platformDefaults.prefix);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("ユーザー設定でbindingsの一部のキーを上書きできる", () => {
    expect(platformDefaults.bindings?.["d"]).toBe("split-vertical");
    const resolved = resolveKeybindings(
      { keybindings: { bindings: { d: "close-tile" } } },
      createTestNiwaApi(),
    );
    expect(resolved.bindings?.["d"]).toBe("close-tile");
    // 上書きしていないキーはデフォルトのまま
    expect(resolved.bindings?.["w"]).toBe(platformDefaults.bindings?.["w"]);
  });

  test("bindingsの不正なバインド文字列・未知のアクション名のエントリだけ除外し、残りは有効にする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveKeybindings(
        {
          keybindings: {
            bindings: {
              "cmd+d": "close-tile", // 2打目キーにcmd/ctrlは使えない（不正）
              q: "not-a-real-action", // デフォルトで未割り当てのキー（存在しないアクション名の検証用）
            } as never,
          },
        },
        createTestNiwaApi(),
      );
      expect(resolved.bindings?.["cmd+d"]).toBeUndefined();
      expect(resolved.bindings?.["q"]).toBeUndefined();
      // デフォルトのエントリは影響を受けず残っている
      expect(Object.keys(resolved.bindings ?? {}).length).toBe(
        Object.keys(platformDefaults.bindings ?? {}).length,
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  test("ユーザー設定でdirectを追加できる", () => {
    const resolved = resolveKeybindings(
      { keybindings: { direct: { "cmd+shift+c": "copy-selection" } } },
      createTestNiwaApi(),
    );
    expect(resolved.direct?.["cmd+shift+c"]).toBe("copy-selection");
  });

  test("directの不正なバインド文字列・未知のアクション名は警告付きで除外される", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveKeybindings(
        {
          keybindings: {
            direct: { d: "copy-selection", "cmd+z": "not-a-real-action" } as never,
          },
        },
        createTestNiwaApi(),
      );
      expect(resolved.direct?.["d" as never]).toBeUndefined();
      expect(resolved.direct?.["cmd+z" as never]).toBeUndefined();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("keybindingsが関数（KeybindingsFn）の場合、デフォルトの上にniwa.keybindで重ねられる", () => {
    const resolved = resolveKeybindings(
      {
        keybindings: (niwa) => {
          niwa.keybind("d", "close-tile");
        },
      },
      createTestNiwaApi(),
    );
    expect(resolved.bindings?.["d"]).toBe("close-tile");
    // 上書きしていないキーはデフォルトのまま
    expect(resolved.bindings?.["w"]).toBe(platformDefaults.bindings?.["w"]);
    expect(resolved.prefix).toBe(platformDefaults.prefix);
  });

  test("keybindingsが関数の場合、niwa.keybindに渡した関数ハンドラはcustom BindingTargetになる", () => {
    const resolved = resolveKeybindings(
      {
        keybindings: (niwa) => {
          niwa.keybind("m", () => {});
        },
      },
      createTestNiwaApi(),
    );
    expect(resolved.bindings?.["m"]).toMatchObject({ kind: "custom" });
  });

  test("keybindingsが関数の場合、niwa.unbindでデフォルトのバインドを消せる", () => {
    expect(platformDefaults.bindings?.["w"]).toBe("close-tile");
    const resolved = resolveKeybindings(
      {
        keybindings: (niwa) => {
          niwa.unbind("w");
        },
      },
      createTestNiwaApi(),
    );
    expect(resolved.bindings?.["w"]).toBeUndefined();
  });

  test("nullを渡すとrepeatTimeoutMsはデフォルト(500)になる", () => {
    const resolved = resolveKeybindings(null, createTestNiwaApi());
    expect(resolved.repeatTimeoutMs).toBe(500);
  });

  test("ユーザー設定でrepeatTimeoutMsを上書きできる", () => {
    const resolved = resolveKeybindings(
      { keybindings: { repeatTimeoutMs: 300 } },
      createTestNiwaApi(),
    );
    expect(resolved.repeatTimeoutMs).toBe(300);
  });

  test("不正なrepeatTimeoutMsは警告付きでデフォルトにフォールバックする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveKeybindings(
        { keybindings: { repeatTimeoutMs: -1 } },
        createTestNiwaApi(),
      );
      expect(resolved.repeatTimeoutMs).toBe(500);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("ユーザー設定でbindingsのエントリにrepeat:trueを指定できる（tmuxのbind-key -r相当）", () => {
    const resolved = resolveKeybindings(
      { keybindings: { bindings: { h: { target: "resize-left", repeat: true } } } },
      createTestNiwaApi(),
    );
    expect(resolved.bindings?.["h"]).toEqual({ target: "resize-left", repeat: true });
  });

  test("keybindingsが関数の場合、niwa.keybindのrepeat:trueオプションが反映される", () => {
    const resolved = resolveKeybindings(
      {
        keybindings: (niwa) => {
          niwa.keybind("h", "resize-left", { repeat: true });
        },
      },
      createTestNiwaApi(),
    );
    expect(resolved.bindings?.["h"]).toEqual({ target: "resize-left", repeat: true });
  });

  test("keybindingsが関数の場合、niwa.repeatTimeoutでrepeatTimeoutMsを上書きできる", () => {
    const resolved = resolveKeybindings(
      {
        keybindings: (niwa) => {
          niwa.repeatTimeout(200);
        },
      },
      createTestNiwaApi(),
    );
    expect(resolved.repeatTimeoutMs).toBe(200);
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

  test('titleBarは"default"/"hidden"だけ受け付ける', () => {
    expect(resolveAppearance({ appearance: { titleBar: "hidden" } }).titleBar).toBe("hidden");
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(resolveAppearance({ appearance: { titleBar: "hiddenInset" as never } }).titleBar).toBe(
        defaultAppearance.titleBar,
      );
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test('tabBarは"auto"/"always"だけ受け付ける', () => {
    expect(resolveAppearance({ appearance: { tabBar: "always" } }).tabBar).toBe("always");
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(resolveAppearance({ appearance: { tabBar: "hover" as never } }).tabBar).toBe(
        defaultAppearance.tabBar,
      );
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveBrowser", () => {
  test("nullを渡すとdefaultBrowserConfigがそのまま返る", () => {
    expect(resolveBrowser(null)).toEqual(defaultBrowserConfig);
  });

  test("defaultUrlを部分上書きできる", () => {
    const resolved = resolveBrowser({ browser: { defaultUrl: "https://example.com" } });
    expect(resolved.defaultUrl).toBe("https://example.com");
  });

  test("不正な型のフィールドは警告付きでデフォルトにフォールバックする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveBrowser({ browser: { defaultUrl: "" } });
      expect(resolved.defaultUrl).toBe(defaultBrowserConfig.defaultUrl);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveBoard", () => {
  test("nullを渡すとdefaultBoardConfigがそのまま返る（既定はcwdの引き継ぎ）", () => {
    expect(resolveBoard(null)).toEqual(defaultBoardConfig);
    expect(defaultBoardConfig.newTabCwd).toBe("inherit");
  });

  test('newTabCwdに"worktree"を指定できる', () => {
    expect(resolveBoard({ board: { newTabCwd: "worktree" } }).newTabCwd).toBe("worktree");
  });

  test("未知の値は警告付きでデフォルトにフォールバックする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveBoard({
        board: { newTabCwd: "board" as unknown as "inherit" },
      });
      expect(resolved.newTabCwd).toBe("inherit");
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveMouse", () => {
  test("nullを渡すとdefaultMouseConfigがそのまま返る", () => {
    expect(resolveMouse(null)).toEqual(defaultMouseConfig);
  });

  test("copyOnSelectを有効化できる", () => {
    expect(resolveMouse({ mouse: { copyOnSelect: true } }).copyOnSelect).toBe(true);
  });

  test("不正な型のフィールドは警告付きでデフォルトにフォールバックする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveMouse({ mouse: { copyOnSelect: "yes" as never } });
      expect(resolved.copyOnSelect).toBe(defaultMouseConfig.copyOnSelect);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveSelectionMenu", () => {
  test("未設定ならnull", () => {
    expect(resolveSelectionMenu(null)).toBeNull();
    expect(resolveSelectionMenu({ mouse: { copyOnSelect: true } })).toBeNull();
  });

  test("設定された関数をそのまま返す", () => {
    const fn = () => [];
    expect(resolveSelectionMenu({ mouse: { selectionMenu: fn } })).toBe(fn);
  });

  test("関数以外は警告付きで無効化する", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(resolveSelectionMenu({ mouse: { selectionMenu: "open" as never } })).toBeNull();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveShell", () => {
  test("nullを渡すとundefined（OS標準シェルへフォールバック）を返す", () => {
    expect(resolveShell(null)).toBeUndefined();
  });

  test("shell未指定ならundefinedを返す", () => {
    expect(resolveShell({})).toBeUndefined();
  });

  test("shell.defaultを指定するとその値が返る", () => {
    expect(resolveShell({ shell: { default: "/bin/bash" } })).toBe("/bin/bash");
  });

  test("空文字列など不正な値は警告付きでundefinedにフォールバックする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(resolveShell({ shell: { default: "" } })).toBeUndefined();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveWorkspaceDefaultCwd", () => {
  test("nullを渡すとundefined（OS標準ホームディレクトリへフォールバック）を返す", () => {
    expect(resolveWorkspaceDefaultCwd(null)).toBeUndefined();
  });

  test("workspace未指定ならundefinedを返す", () => {
    expect(resolveWorkspaceDefaultCwd({})).toBeUndefined();
  });

  test("workspace.defaultCwdを指定するとその値が返る", () => {
    expect(resolveWorkspaceDefaultCwd({ workspace: { defaultCwd: "/home/eetann/projects" } })).toBe(
      "/home/eetann/projects",
    );
  });

  test("空文字列など不正な値は警告付きでundefinedにフォールバックする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(resolveWorkspaceDefaultCwd({ workspace: { defaultCwd: "" } })).toBeUndefined();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveShellProfiles", () => {
  test("nullを渡すと検出済みプロファイルのみ返す", () => {
    const detected = [{ id: "powershell", name: "PowerShell", command: "powershell.exe -NoLogo" }];
    expect(resolveShellProfiles(null, detected)).toEqual(detected);
  });

  test("shell.profiles未指定なら検出済みプロファイルのみ返す", () => {
    const detected = [{ id: "powershell", name: "PowerShell", command: "powershell.exe -NoLogo" }];
    expect(resolveShellProfiles({}, detected)).toEqual(detected);
  });

  test("検出済みプロファイルとユーザー設定のprofilesをマージする", () => {
    const detected = [{ id: "powershell", name: "PowerShell", command: "powershell.exe -NoLogo" }];
    const resolved = resolveShellProfiles(
      { shell: { profiles: [{ id: "ssh-dev", name: "dev server", command: "ssh dev" }] } },
      detected,
    );
    expect(resolved).toEqual([
      { id: "powershell", name: "PowerShell", command: "powershell.exe -NoLogo" },
      { id: "ssh-dev", name: "dev server", command: "ssh dev" },
    ]);
  });

  test("同じidのユーザー設定は検出済みプロファイルを上書きする", () => {
    const detected = [{ id: "powershell", name: "PowerShell", command: "powershell.exe -NoLogo" }];
    const resolved = resolveShellProfiles(
      { shell: { profiles: [{ id: "powershell", name: "PS (custom)", command: "pwsh.exe" }] } },
      detected,
    );
    expect(resolved).toEqual([{ id: "powershell", name: "PS (custom)", command: "pwsh.exe" }]);
  });

  test("不正なプロファイル（id/name/command欠如）は警告付きでスキップする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveShellProfiles(
        {
          shell: {
            profiles: [
              { id: "ok", name: "OK", command: "ok-cmd" },
              { id: "", name: "missing id", command: "x" } as never,
              { id: "no-command", name: "no command" } as never,
            ],
          },
        },
        [],
      );
      expect(resolved).toEqual([{ id: "ok", name: "OK", command: "ok-cmd" }]);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("shell.profilesが配列でない場合は警告付きで無視する", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveShellProfiles({ shell: { profiles: "not-an-array" as never } }, []);
      expect(resolved).toEqual([]);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveLayouts", () => {
  test("nullを渡すと空オブジェクトを返す", () => {
    expect(resolveLayouts(null)).toEqual({});
  });

  test("layouts未指定なら空オブジェクトを返す", () => {
    expect(resolveLayouts({})).toEqual({});
  });

  test("有効なプリセットはそのまま返す", () => {
    const preset = {
      description: "dev",
      layout: { kind: "tile" as const, tabs: [{ command: "nvim" }] },
    };
    expect(resolveLayouts({ layouts: { dev: preset } })).toEqual({ dev: preset });
  });

  test("layoutフィールドを欠くエントリは警告付きでスキップする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveLayouts({
        layouts: {
          ok: { layout: { kind: "tile", tabs: [{}] } },
          broken: { description: "no layout field" } as never,
        },
      });
      expect(resolved).toEqual({ ok: { layout: { kind: "tile", tabs: [{}] } } });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("layouts自体がオブジェクトでない場合は警告付きで空オブジェクトを返す", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(resolveLayouts({ layouts: "not-an-object" as never })).toEqual({});
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveCustomView", () => {
  test("nullを渡すとnull（機能オフ）を返す", () => {
    expect(resolveCustomView(null)).toBeNull();
  });

  test("customView未指定ならnullを返す", () => {
    expect(resolveCustomView({})).toBeNull();
  });

  test("pathを指定するとconfigDirPath基準のfile://に解決される", () => {
    const resolved = resolveCustomView({ customView: { name: "Notes", path: "./notes.html" } });
    expect(resolved).not.toBeNull();
    expect(resolved?.name).toBe("Notes");
    // Windowsのfile:// URLは file:///C:/... 形式になるためpathToFileURLで期待値を作る
    expect(resolved?.url).toBe(pathToFileURL(join(configDirPath(), "notes.html")).href);
  });

  test("urlを指定するとそのまま使われる", () => {
    const resolved = resolveCustomView({
      customView: { name: "Docs", url: "https://example.com" },
    });
    expect(resolved).toEqual({ name: "Docs", url: "https://example.com" });
  });

  test("pathとurlが両方指定されている場合はpathが優先される", () => {
    const resolved = resolveCustomView({
      customView: { path: "./notes.html", url: "https://example.com" },
    });
    // Windowsのfile:// URLは file:///C:/... 形式になるためpathToFileURLで期待値を作る
    expect(resolved?.url).toBe(pathToFileURL(join(configDirPath(), "notes.html")).href);
  });

  test("nameを省略すると'Custom View'にフォールバックする", () => {
    const resolved = resolveCustomView({ customView: { url: "https://example.com" } });
    expect(resolved?.name).toBe("Custom View");
  });

  test("pathとurlどちらも無効なら警告付きでnullを返す", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(resolveCustomView({ customView: { name: "Broken" } })).toBeNull();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('設定ファイルのniwa.on("bell")', () => {
  test("keybindings関数の中で登録したハンドラをextractBellHandlerで取り出せる", () => {
    const api = createTestNiwaApi();
    const handler = (): void => {};

    resolveKeybindings({ keybindings: (niwa) => niwa.on("bell", handler) }, api);

    expect(api.extractBellHandler()).toBe(handler);
  });

  test("登録していなければnullのまま（既定の処理を使う）", () => {
    const api = createTestNiwaApi();

    resolveKeybindings({ keybindings: (niwa) => niwa.keybind("d", "close-tile") }, api);

    expect(api.extractBellHandler()).toBeNull();
  });
});
