import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_HOVER_BUTTON_POSITION,
  DEFAULT_HOVER_HANDLE_ICON,
  DEFAULT_HOVER_HANDLE_SHAPE,
  DEFAULT_HOVER_TRIGGER_PX,
  STATUS_BAR_MIN_INTERVAL_MS,
  HOVER_TRIGGER_MAX_PX,
  builtinThemes,
  defaultAppearance,
  defaultBoardConfig,
  defaultBrowserConfig,
  defaultLinkConfig,
  defaultLinkRules,
  defaultMouseConfig,
  defaultSidebarConfig,
  defaultTerminalConfig,
  defaultUiColors,
  platformDefaultKeybindings,
} from "@niwaterm/config";
import { type ConfigDiagnostics, createConfigDiagnostics } from "./config-diagnostics";
import {
  configDirPath,
  configFilePath,
  decideConfigLoadOutcome,
  loadUserConfig,
  resolveAppearance,
  resolveBoard,
  resolveBrowser,
  resolveCustomViews,
  resolveHoverButtons,
  resolveKeybindings,
  resolveLayouts,
  resolveLink,
  resolveMouse,
  resolveSelectionMenu,
  restoreConfigDirInMessage,
  resolveShell,
  resolveStatusBar,
  resolveShellProfiles,
  resolveSidebar,
  resolveSidebarToolbar,
  resolveTerminal,
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
    setMaxScrollback: () => {},
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
      viewportOffset: 0,
      mouseTracking: false,
      mouseAnyMotion: false,
      mouseShape: "text",
      renderHeld: false,
      paletteCss: null,
      copyMode: null,
      kittyPlacements: [],
      kittyImages: [],
    }),
    dumpText: () => "",
    getRunningCommand: () => null,
    showNotice: () => {},
    setCallbacks: () => {},
    runCommandWhenReady: () => {},
    jumpPrompt: () => false,
    isCopyMode: () => false,
    enterCopyMode: () => {},
    exitCopyMode: () => {},
    handleCopyModeKey: () => false,
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
    openLinkExternal: () => {},
    getLinkOpen: () => "external",
  });
}

/**
 * 診断を集めつつ、ConfigDiagnosticsが同時に出すconsole.logをテスト出力から抑える。
 * 戻り値のrestoreをfinallyで呼ぶこと
 */
function captureDiagnostics(): { diag: ConfigDiagnostics; restore: () => void } {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  return { diag: createConfigDiagnostics(), restore: () => logSpy.mockRestore() };
}

describe("configFilePath", () => {
  const originalConfigDir = process.env["NIWATERM_CONFIG_DIR"];

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env["NIWATERM_CONFIG_DIR"];
    else process.env["NIWATERM_CONFIG_DIR"] = originalConfigDir;
  });

  test(".config/niwaterm/niwaterm.config.ts を指す", () => {
    delete process.env["NIWATERM_CONFIG_DIR"];
    // Windowsは区切りが \ になるため正規化してから比較する
    expect(configFilePath().replaceAll("\\", "/")).toMatch(
      /\.config\/niwaterm\/niwaterm\.config\.ts$/,
    );
  });

  test("NIWATERM_CONFIG_DIRを指定するとそのディレクトリ配下を指す", () => {
    process.env["NIWATERM_CONFIG_DIR"] = join(tmpdir(), "niwaterm-wip-config");
    expect(configDirPath()).toBe(join(tmpdir(), "niwaterm-wip-config"));
    expect(configFilePath()).toBe(join(tmpdir(), "niwaterm-wip-config", "niwaterm.config.ts"));
  });

  test("NIWATERM_CONFIG_DIRが空文字なら既定のディレクトリを使う", () => {
    process.env["NIWATERM_CONFIG_DIR"] = "";
    expect(configDirPath().replaceAll("\\", "/")).toMatch(/\.config\/niwaterm$/);
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

  /** 読み込み失敗（configはnull・errorに理由が入る）を確かめる */
  async function expectLoadFailure(path: string): Promise<void> {
    const result = await loadUserConfig(path);
    expect(result.config).toBeNull();
    expect(result.error).toBeTruthy();
  }

  test("ファイルが存在しない場合はconfig・errorともnullを返す（失敗と区別する）", async () => {
    expect(await loadUserConfig(join(dir, "not-found.config.ts"))).toEqual({
      config: null,
      error: null,
    });
  });

  test("export defaultされたオブジェクトを読み込める", async () => {
    const path = join(dir, "valid.config.ts");
    await writeFile(
      path,
      `export default { keybindings: { prefix: "ctrl+b", bindings: { d: "close-tile" } } };\n`,
    );
    expect((await loadUserConfig(path)).config).toEqual({
      keybindings: { prefix: "ctrl+b", bindings: { d: "close-tile" } },
    });
  });

  test("構文エラーの場合はconfigがnullになり、errorへ理由が入る", async () => {
    const path = join(dir, "broken.config.ts");
    await writeFile(path, "export default { this is not valid typescript ;;;\n");
    await expectLoadFailure(path);
  });

  test("importできないモジュールを参照している場合もerrorへ理由が入る", async () => {
    const path = join(dir, "missing-import.config.ts");
    await writeFile(
      path,
      `import { x } from "./does-not-exist.ts";\nexport default { appearance: { fontSize: x } };\n`,
    );
    const result = await loadUserConfig(path);
    expect(result.config).toBeNull();
    expect(result.error).toContain("does-not-exist");
    // importは一時ディレクトリのコピーに対して走るが、メッセージには元の設定ディレクトリが出る
    expect(result.error).toContain(dir);
    expect(result.error).not.toMatch(/niwaterm-config-[A-Za-z0-9]{6}[/\\]/u);
  });

  test("keybindings以外の形（配列やnull）の場合は読み込み失敗として扱う", async () => {
    const path = join(dir, "invalid-shape.config.ts");
    await writeFile(path, "export default { keybindings: null };\n");
    await expectLoadFailure(path);
  });

  test("keybindingsが関数（KeybindingsFn）の場合も読み込める", async () => {
    const path = join(dir, "fn-keybindings.config.ts");
    await writeFile(
      path,
      `export default { keybindings: (niwa) => { niwa.keybind("d", "close-tile"); } };\n`,
    );
    const loaded = (await loadUserConfig(path)).config;
    expect(typeof loaded?.keybindings).toBe("function");
  });

  test("appearance以外の形（配列やnull）の場合は読み込み失敗として扱う", async () => {
    const path = join(dir, "invalid-appearance-shape.config.ts");
    await writeFile(path, "export default { appearance: null };\n");
    await expectLoadFailure(path);
  });

  test("browser以外の形（配列やnull）の場合は読み込み失敗として扱う", async () => {
    const path = join(dir, "invalid-browser-shape.config.ts");
    await writeFile(path, "export default { browser: null };\n");
    await expectLoadFailure(path);
  });

  test("mouse以外の形（配列やnull）の場合は読み込み失敗として扱う", async () => {
    const path = join(dir, "invalid-mouse-shape.config.ts");
    await writeFile(path, "export default { mouse: null };\n");
    await expectLoadFailure(path);
  });

  test("shell以外の形（配列やnull）の場合は読み込み失敗として扱う", async () => {
    const path = join(dir, "invalid-shell-shape.config.ts");
    await writeFile(path, "export default { shell: null };\n");
    await expectLoadFailure(path);
  });

  test("同一パスへの2回目の読み込みでも、ファイルが更新されていれば最新の内容を返す（キャッシュバスティング）", async () => {
    const path = join(dir, "hot-reload.config.ts");
    await writeFile(path, `export default { keybindings: { bindings: { d: "close-tile" } } };\n`);
    expect((await loadUserConfig(path)).config).toEqual({
      keybindings: { bindings: { d: "close-tile" } },
    });
    await writeFile(path, `export default { keybindings: { bindings: { d: "new-tab" } } };\n`);
    expect((await loadUserConfig(path)).config).toEqual({
      keybindings: { bindings: { d: "new-tab" } },
    });
  });

  test("複数ファイル分割: エントリがimportする非エントリファイルの更新も2回目の読み込みで反映される", async () => {
    const entryPath = join(dir, "niwaterm.config.ts");
    const fontPath = join(dir, "font.ts");
    await writeFile(fontPath, "export const fontSize = 14;\n");
    await writeFile(
      entryPath,
      `import { fontSize } from "./font";\nexport default { appearance: { fontSize } };\n`,
    );
    expect((await loadUserConfig(entryPath)).config).toEqual({ appearance: { fontSize: 14 } });

    await writeFile(fontPath, "export const fontSize = 20;\n");
    expect((await loadUserConfig(entryPath)).config).toEqual({ appearance: { fontSize: 20 } });
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
    const loaded = (await loadUserConfig(entryPath)).config;
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
    expect((await loadUserConfig(entryPath)).config).toEqual({ appearance: { fontSize: 18 } });
  });

  test("エントリファイル自体がシンボリックリンクでも解決できる（dotfiles管理でniwaterm.config.ts等をリンクしている場合）", async () => {
    const realPath = join(dir, "real.config.ts");
    const entryPath = join(dir, "niwaterm.config.ts");
    await writeFile(realPath, `export default { appearance: { fontSize: 22 } };\n`);
    await symlink(realPath, entryPath);
    expect((await loadUserConfig(entryPath)).config).toEqual({ appearance: { fontSize: 22 } });
  });
});

describe("restoreConfigDirInMessage", () => {
  test("Windowsの一時importディレクトリを設定ディレクトリへ置き換える", () => {
    const message = String.raw`ResolveMessage: Cannot find module './handlers.ts' imported from C:\Users\me\AppData\Local\Temp\niwaterm-config-DTFnBI\niwaterm.config.ts`;
    expect(restoreConfigDirInMessage(message, String.raw`C:\Users\me\.config\niwaterm`)).toBe(
      String.raw`ResolveMessage: Cannot find module './handlers.ts' imported from C:\Users\me\.config\niwaterm\niwaterm.config.ts`,
    );
  });

  test("一時ディレクトリが出てこないメッセージはそのまま返す", () => {
    expect(restoreConfigDirInMessage("SyntaxError: Unexpected token", "/home/me")).toBe(
      "SyntaxError: Unexpected token",
    );
  });
});

describe("decideConfigLoadOutcome", () => {
  const configFile = "/home/user/.config/niwaterm/niwaterm.config.ts";

  test("読み込めたら適用する。前回もエラーが無ければ通知はしない", () => {
    expect(
      decideConfigLoadOutcome({
        configFile,
        loadError: null,
        previousError: null,
        alreadyApplied: true,
      }),
    ).toEqual({ apply: true, notification: null });
  });

  test("エラーから復帰したときは1回だけ知らせる", () => {
    const outcome = decideConfigLoadOutcome({
      configFile,
      loadError: null,
      previousError: "SyntaxError",
      alreadyApplied: true,
    });
    expect(outcome.apply).toBe(true);
    expect(outcome.notification?.title).toBe("設定ファイルを読み込み直しました");
  });

  test("適用済みの状態で読み込めなくなったら適用せず、直前の設定を残す", () => {
    const outcome = decideConfigLoadOutcome({
      configFile,
      loadError: "SyntaxError",
      previousError: null,
      alreadyApplied: true,
    });
    expect(outcome.apply).toBe(false);
    expect(outcome.notification?.body).toContain("直前に読み込めた設定のまま");
  });

  test("同じエラーが続く間は通知を繰り返さない（保存のたびに鳴らさない）", () => {
    expect(
      decideConfigLoadOutcome({
        configFile,
        loadError: "SyntaxError",
        previousError: "SyntaxError",
        alreadyApplied: true,
      }),
    ).toEqual({ apply: false, notification: null });
  });

  test("まだ一度も適用していなければ、読めなくても既定値を当てる（残せる前の状態が無い）", () => {
    const outcome = decideConfigLoadOutcome({
      configFile,
      loadError: "SyntaxError",
      previousError: null,
      alreadyApplied: false,
    });
    expect(outcome.apply).toBe(true);
    expect(outcome.notification?.body).toBe("SyntaxError");
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

  test("copyMode・copyModeSearchもキー単位で上書きでき、不正なエントリだけ除外する", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const diag = createConfigDiagnostics();
      const resolved = resolveKeybindings(
        {
          keybindings: {
            copyMode: { "ctrl+v": "copy-select-char", x: "close-tile" as never },
            copyModeSearch: { "a b": "copy-search-confirm" },
          },
        },
        createTestNiwaApi(),
        diag,
      );
      expect(resolved.copyMode?.["ctrl+v"]).toBe("copy-select-char");
      expect(resolved.copyMode?.["x"]).toBeUndefined();
      expect(resolved.copyModeSearch?.["a b"]).toBeUndefined();
      // 上書きしていないキーはデフォルトのまま
      expect(resolved.copyMode?.["g g"]).toBe("copy-top");
      expect(resolved.copyModeSearch?.["enter"]).toBe("copy-search-confirm");
      expect(diag.list().map((d) => d.scope)).toEqual([
        'keybindings.copyMode["x"]',
        'keybindings.copyModeSearch["a b"]',
      ]);
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

  test("keybindingsの関数が途中で例外を投げても、そこまでの登録を残して例外は外へ出さない", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const resolved = resolveKeybindings(
        {
          keybindings: (niwa) => {
            niwa.prefix("cmd+j");
            niwa.keybind("d", "close-tile");
            (undefined as unknown as { boom: () => void }).boom();
            niwa.keybind("z", "new-tab");
          },
        },
        createTestNiwaApi(),
        diag,
      );
      expect(resolved.prefix).toBe("cmd+j");
      expect(resolved.bindings?.["d"]).toBe("close-tile");
      // 例外より後ろの登録だけが欠ける
      expect(resolved.bindings?.["z"]).toBe(platformDefaults.bindings?.["z"]);
      expect(diag.list()).toEqual([
        {
          level: "error",
          scope: "keybindings",
          message: expect.stringContaining("関数が途中で失敗しました"),
        },
      ]);
    } finally {
      restore();
    }
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

  test("themeで選んだテーマの色が土台になり、書いた色だけが上書きする", () => {
    const tokyo = builtinThemes["tokyo-night"].colors;
    const resolved = resolveAppearance({
      appearance: { theme: "tokyo-night", cursor: "#ff0000", ui: { accent: "#00ff00" } },
    });
    expect(resolved.theme).toBe("tokyo-night");
    expect(resolved.foreground).toBe(tokyo.foreground);
    expect(resolved.background).toBe(tokyo.background);
    expect(resolved.ansiColors).toEqual([...tokyo.ansiColors]);
    expect(resolved.cursor).toBe("#ff0000");
    expect(resolved.ui.accent).toBe("#00ff00");
    expect(resolved.ui.border).toBe(tokyo.ui.border);
  });

  test("ansiColorsの空けた番号はテーマの色のまま残る", () => {
    const tokyo = builtinThemes["tokyo-night"].colors;
    const resolved = resolveAppearance({
      appearance: { theme: "tokyo-night", ansiColors: [undefined, "#ff5555"] },
    });
    expect(resolved.ansiColors[0]).toBe(tokyo.ansiColors[0]);
    expect(resolved.ansiColors[1]).toBe("#ff5555");
    expect(resolved.ansiColors[2]).toBe(tokyo.ansiColors[2]);
  });

  test("知らないthemeは警告付きで既定のテーマへ戻す", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveAppearance({ appearance: { theme: "monokai" as never } });
      expect(resolved.theme).toBe(defaultAppearance.theme);
      expect(resolved.background).toBe(defaultAppearance.background);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
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

  test("tileBorderRadiusは0以上の数値だけ受け付ける", () => {
    expect(resolveAppearance({ appearance: { tileBorderRadius: 0 } }).tileBorderRadius).toBe(0);
    expect(resolveAppearance({ appearance: { tileBorderRadius: 10 } }).tileBorderRadius).toBe(10);
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const bad of [-1, Number.NaN, "6px"]) {
        expect(
          resolveAppearance({ appearance: { tileBorderRadius: bad as never } }).tileBorderRadius,
        ).toBe(defaultAppearance.tileBorderRadius);
      }
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("tileGap・inactiveTileDim・tileShadowは不正値なら既定値を使う", () => {
    const resolved = resolveAppearance({
      appearance: { tileGap: 0, inactiveTileDim: 0, tileShadow: "none" },
    });
    expect(resolved.tileGap).toBe(0);
    expect(resolved.inactiveTileDim).toBe(0);
    expect(resolved.tileShadow).toBe("none");
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const fallback = resolveAppearance({
        appearance: { tileGap: -2, inactiveTileDim: 1.5, tileShadow: "" },
      });
      expect(fallback.tileGap).toBe(defaultAppearance.tileGap);
      expect(fallback.inactiveTileDim).toBe(defaultAppearance.inactiveTileDim);
      expect(fallback.tileShadow).toBe(defaultAppearance.tileShadow);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("tileAnimationは真偽値だけ受け付ける", () => {
    expect(resolveAppearance(null).tileAnimation).toBe(true);
    expect(resolveAppearance({ appearance: { tileAnimation: false } }).tileAnimation).toBe(false);
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const fallback = resolveAppearance({
        appearance: { tileAnimation: "off" as unknown as boolean },
      });
      expect(fallback.tileAnimation).toBe(defaultAppearance.tileAnimation);
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

  test('popupToolbarは"always"/"hover"だけ受け付ける', () => {
    expect(resolveAppearance({}).popupToolbar).toBe("always");
    expect(resolveAppearance({ appearance: { popupToolbar: "hover" } }).popupToolbar).toBe("hover");
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        resolveAppearance({ appearance: { popupToolbar: "auto" as never } }).popupToolbar,
      ).toBe(defaultAppearance.popupToolbar);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("uiはフィールド単位でマージする", () => {
    const resolved = resolveAppearance({ appearance: { ui: { accent: "#ff0000" } } });
    expect(resolved.ui.accent).toBe("#ff0000");
    expect(resolved.ui.border).toBe(defaultUiColors.border);
    expect(resolved.ui.warning).toBe(defaultUiColors.warning);
  });

  test("uiの不正な値は警告付きでそのフィールドだけデフォルトに戻す", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveAppearance({
        appearance: { ui: { accent: "", border: 0xff0000 as never, success: "#00ff00" } },
      });
      expect(resolved.ui.accent).toBe(defaultUiColors.accent);
      expect(resolved.ui.border).toBe(defaultUiColors.border);
      expect(resolved.ui.success).toBe("#00ff00");
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

  test("namingに自動命名の方式を指定できる（既定はdirectory-follow）", () => {
    expect(defaultBoardConfig.naming).toBe("directory-follow");
    expect(resolveBoard({ board: { naming: "directory" } }).naming).toBe("directory");
    expect(resolveBoard({ board: { naming: "sequential" } }).naming).toBe("sequential");
  });

  test("未知の値は警告付きでデフォルトにフォールバックする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveBoard({
        board: {
          newTabCwd: "board" as unknown as "inherit",
          naming: "cwd" as unknown as "directory",
        },
      });
      expect(resolved.newTabCwd).toBe("inherit");
      expect(resolved.naming).toBe("directory-follow");
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("resolveSidebar", () => {
  test("nullを渡すと既定の3項目（フェーズ・ブランチ・エージェント状態）が返る", () => {
    expect(resolveSidebar(null)).toEqual(defaultSidebarConfig);
  });

  test("並べた項目がその順で返る", () => {
    const resolved = resolveSidebar({
      sidebar: { boardStatus: ["tab-var:ticket", { source: "builtin:branch", prefix: "" }] },
    });

    expect(resolved.boardStatus).toEqual([
      { source: { kind: "tab-var", name: "ticket" }, prefix: null, color: null },
      { source: { kind: "builtin", id: "branch" }, prefix: "", color: null },
    ]);
  });

  test("空配列はステータスラインを出さない指定として通る", () => {
    expect(resolveSidebar({ sidebar: { boardStatus: [] } }).boardStatus).toEqual([]);
  });
});

describe("resolveTerminal", () => {
  test("nullを渡すとdefaultTerminalConfigがそのまま返る", () => {
    expect(resolveTerminal(null)).toEqual(defaultTerminalConfig);
  });

  test("scrollbackを変更できる", () => {
    expect(resolveTerminal({ terminal: { scrollback: 50_000 } }).scrollback).toBe(50_000);
  });

  test("scrollback: 0（スクロールバック無し）は有効な値として通す", () => {
    expect(resolveTerminal({ terminal: { scrollback: 0 } }).scrollback).toBe(0);
  });

  test("負数・小数・数値以外は警告付きでデフォルトにフォールバックする", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const invalid of [-1, 1.5, "10000" as never]) {
        expect(resolveTerminal({ terminal: { scrollback: invalid } }).scrollback).toBe(
          defaultTerminalConfig.scrollback,
        );
      }
      expect(logSpy).toHaveBeenCalledTimes(3);
    } finally {
      logSpy.mockRestore();
    }
  });
});
describe("resolveLink", () => {
  /** 既定のルールを解決済みの形（webviewへ送る形）へ直したもの */
  const resolvedDefaultRules = defaultLinkRules.map((rule) => ({
    source: rule.regex as string,
    flags: "",
    format: rule.format as string,
  }));

  test("nullを渡すとOSごとの既定値がそのまま返る", () => {
    expect(resolveLink(null, createConfigDiagnostics(), "darwin")).toEqual({
      ...defaultLinkConfig("darwin"),
      rules: resolvedDefaultRules,
    });
    expect(resolveLink(null, createConfigDiagnostics(), "win32").modifier).toBe("ctrl");
    expect(resolveLink(null, createConfigDiagnostics(), "darwin").modifier).toBe("cmd");
  });

  test("modifier・openを変更できる", () => {
    const resolved = resolveLink({ link: { modifier: "alt", open: "browser-tab" } });
    expect(resolved.modifier).toBe("alt");
    expect(resolved.open).toBe("browser-tab");
  });

  test("rulesを指定すると既定のルールを置き換える", () => {
    const resolved = resolveLink({
      link: { rules: [{ regex: /ISSUE-(\d+)/u, format: "https://example.com/issues/$1" }] },
    });
    expect(resolved.rules).toEqual([
      { source: "ISSUE-(\\d+)", flags: "u", format: "https://example.com/issues/$1" },
    ]);
  });

  test("文字列で書いたregexも受け取り、formatの省略は$0になる", () => {
    const resolved = resolveLink({ link: { rules: [{ regex: "https?://\\S+" }] } });
    expect(resolved.rules).toEqual([{ source: "https?://\\S+", flags: "", format: "$0" }]);
  });

  test("g・yフラグは落とす（マッチ列挙のためgは利用側で必ず付けるため）", () => {
    const resolved = resolveLink({ link: { rules: [{ regex: /todo/giy }] } });
    expect(resolved.rules[0]?.flags).toBe("i");
  });

  test("不正なルールは警告付きで捨て、残りのルールで動かす", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveLink({
        link: {
          rules: [
            { regex: "[" },
            { regex: 42 as never },
            "rule" as never,
            { regex: "ok", format: 1 as never },
          ],
        },
      });
      expect(resolved.rules).toEqual([{ source: "ok", flags: "", format: "$0" }]);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("ルールが全滅した場合だけ既定のルールへ戻す", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(resolveLink({ link: { rules: [{ regex: "[" }] } }).rules).toEqual(
        resolvedDefaultRules,
      );
      expect(resolveLink({ link: { rules: "url" as never } }).rules).toEqual(resolvedDefaultRules);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("rulesに空配列を渡すと素のURLの検出を無効にできる", () => {
    expect(resolveLink({ link: { rules: [] } }).rules).toEqual([]);
  });

  test("不正なmodifier・openは警告付きで既定値へ落とす", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const resolved = resolveLink(
        { link: { modifier: "hyper" as never, open: "popup" as never } },
        createConfigDiagnostics(),
        "win32",
      );
      expect(resolved.modifier).toBe("ctrl");
      expect(resolved.open).toBe("external");
      expect(logSpy).toHaveBeenCalledTimes(2);
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

  test("copyModeOnSelectを有効化できる", () => {
    expect(resolveMouse({ mouse: { copyModeOnSelect: true } }).copyModeOnSelect).toBe(true);
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

describe("resolveHoverButtons", () => {
  const items = () => [{ label: "lazygit", run: () => {} }];

  test("未指定・nullなら空（機能オフ）を返す", () => {
    expect(resolveHoverButtons(null)).toEqual([]);
    expect(resolveHoverButtons({})).toEqual([]);
  });

  test("id省略時はpositionがidになり、重複はサフィックスで一意にする", () => {
    const groups = resolveHoverButtons({
      hoverButtons: [
        { position: "right", items },
        { position: "right", items },
        { position: "top-left", items },
      ],
    });
    expect(groups.map((group) => group.id)).toEqual(["right", "right-2", "top-left"]);
  });

  test("triggerは省略時に既定値、範囲外なら丸めて警告する", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const groups = resolveHoverButtons(
        {
          hoverButtons: [
            { position: "right", items },
            { position: "left", items, trigger: 40 },
            { position: "top", items, trigger: 1000 },
            { position: "bottom", items, trigger: "wide" as never },
          ],
        },
        diag,
      );
      expect(groups.map((group) => group.trigger)).toEqual([
        DEFAULT_HOVER_TRIGGER_PX,
        40,
        HOVER_TRIGGER_MAX_PX,
        DEFAULT_HOVER_TRIGGER_PX,
      ]);
      expect(diag.list().map((entry) => entry.scope)).toEqual([
        "hoverButtons[2].trigger",
        "hoverButtons[3].trigger",
      ]);
    } finally {
      restore();
    }
  });

  test("positionが不正な要素だけ落として警告する", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const groups = resolveHoverButtons(
        {
          hoverButtons: [
            { position: "middle" as never, items },
            { position: "left", items },
          ],
        },
        diag,
      );
      expect(groups.map((group) => group.position)).toEqual(["left"]);
      expect(diag.list()).toEqual([
        {
          level: "warn",
          scope: "hoverButtons[0].position",
          message: expect.stringContaining("この要素だけ無視します"),
        },
      ]);
    } finally {
      restore();
    }
  });

  test("itemsが関数でない要素だけ落として警告する", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const groups = resolveHoverButtons(
        { hoverButtons: [{ position: "left", items: "nope" as never }] },
        diag,
      );
      expect(groups).toEqual([]);
      expect(diag.list()[0]?.scope).toBe("hoverButtons[0].items");
    } finally {
      restore();
    }
  });

  test("showが関数でなければ全タブへ出す扱いにしてボタン自体は残す", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const groups = resolveHoverButtons(
        { hoverButtons: [{ position: "left", show: true as never, items }] },
        diag,
      );
      expect(groups).toHaveLength(1);
      expect(groups[0]?.show).toBeUndefined();
      expect(diag.list()[0]?.scope).toBe("hoverButtons[0].show");
    } finally {
      restore();
    }
  });

  test("cssは未指定なら空文字列になる", () => {
    const groups = resolveHoverButtons({
      hoverButtons: [
        { position: "left", items },
        { position: "right", css: ".toc {}", items },
      ],
    });
    expect(groups.map((group) => group.css)).toEqual(["", ".toc {}"]);
  });

  test("positionは省略時に既定の位置へ置き、idもその位置から付ける", () => {
    const groups = resolveHoverButtons({ hoverButtons: [{ items }] });
    expect(groups.map((group) => [group.id, group.position])).toEqual([
      [DEFAULT_HOVER_BUTTON_POSITION, DEFAULT_HOVER_BUTTON_POSITION],
    ]);
  });

  test("handleは省略時に既定の形で端へ貼り付け、falseなら取っ手なしになる", () => {
    const groups = resolveHoverButtons({
      hoverButtons: [
        { position: "left", items },
        { position: "right", items, handle: false },
        { position: "top", items, handle: { style: "floating", icon: "<b>+</b>" } },
      ],
    });
    expect(groups.map((group) => group.handle)).toEqual([
      { style: "edge", shape: DEFAULT_HOVER_HANDLE_SHAPE, icon: DEFAULT_HOVER_HANDLE_ICON },
      null,
      { style: "floating", shape: DEFAULT_HOVER_HANDLE_SHAPE, icon: "<b>+</b>" },
    ]);
  });

  test("handleの不正なフィールドは警告して既定値へ落とし、取っ手自体は残す", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const groups = resolveHoverButtons(
        {
          hoverButtons: [
            { position: "left", items, handle: { style: "big" as never, shape: "rect" } },
            { position: "right", items, handle: true as never },
          ],
        },
        diag,
      );
      expect(groups.map((group) => group.handle)).toEqual([
        { style: "edge", shape: "rect", icon: DEFAULT_HOVER_HANDLE_ICON },
        { style: "edge", shape: DEFAULT_HOVER_HANDLE_SHAPE, icon: DEFAULT_HOVER_HANDLE_ICON },
      ]);
      expect(diag.list().map((entry) => entry.scope)).toEqual([
        "hoverButtons[0].handle.style",
        "hoverButtons[1].handle",
      ]);
    } finally {
      restore();
    }
  });
});

describe("resolveCustomViews", () => {
  test("pathの指すファイルが無くてもビューは残し、警告だけ出す", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const { views } = resolveCustomViews(
        { customViews: [{ name: "Notes", path: "./definitely-missing.html" }] },
        diag,
      );
      // 存在するかどうかでid採番が変わると、HTMLを置いた途端にキーバインドから指すidがずれる
      expect(views.map((view) => view.id)).toEqual(["notes"]);
      expect(diag.list()).toEqual([
        {
          level: "warn",
          scope: "customViews[0].path",
          message: expect.stringContaining("ファイルが見つかりません"),
        },
      ]);
    } finally {
      restore();
    }
  });

  test("nullを渡すと空（機能オフ）を返す", () => {
    expect(resolveCustomViews(null).views).toEqual([]);
  });

  test("customViews未指定なら空を返す", () => {
    expect(resolveCustomViews({}).views).toEqual([]);
  });

  test("pathを指定するとconfigDirPath基準のfile://に解決される", () => {
    // 実在しないパスなので存在チェックの警告が出る。ここで見たいのは解決結果だけなので捨てる
    const { diag, restore } = captureDiagnostics();
    try {
      const { views } = resolveCustomViews(
        { customViews: [{ name: "Notes", path: "./notes.html" }] },
        diag,
      );
      expect(views).toHaveLength(1);
      expect(views[0]?.name).toBe("Notes");
      // Windowsのfile:// URLは file:///C:/... 形式になるためpathToFileURLで期待値を作る
      expect(views[0]?.url).toBe(pathToFileURL(join(configDirPath(), "notes.html")).href);
    } finally {
      restore();
    }
  });

  test("urlを指定するとそのまま使われる", () => {
    const { views } = resolveCustomViews({
      customViews: [{ name: "Docs", url: "https://example.com" }],
    });
    expect(views[0]).toEqual({
      id: "docs",
      name: "Docs",
      url: "https://example.com",
      handlerNames: [],
    });
  });

  test("pathとurlが両方指定されている場合はpathが優先される", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const { views } = resolveCustomViews(
        { customViews: [{ path: "./notes.html", url: "https://example.com" }] },
        diag,
      );
      // Windowsのfile:// URLは file:///C:/... 形式になるためpathToFileURLで期待値を作る
      expect(views[0]?.url).toBe(pathToFileURL(join(configDirPath(), "notes.html")).href);
    } finally {
      restore();
    }
  });

  test("nameを省略すると並び順の連番へフォールバックする", () => {
    const { views } = resolveCustomViews({
      customViews: [{ url: "https://example.com" }, { url: "https://example.org" }],
    });
    expect(views.map((view) => view.name)).toEqual(["Custom View 1", "Custom View 2"]);
  });

  test("idを省略するとnameから導かれる", () => {
    const { views } = resolveCustomViews({
      customViews: [{ name: "My Notes", url: "https://example.com" }],
    });
    expect(views[0]?.id).toBe("my-notes");
  });

  test("idを明示すると正規化した上でそれが使われる", () => {
    const { views } = resolveCustomViews({
      customViews: [{ id: "My_Notes", name: "Notes", url: "https://example.com" }],
    });
    expect(views[0]?.id).toBe("my-notes");
  });

  test("nameからidを作れない（英数字を含まない）場合は連番のidになる", () => {
    const { views } = resolveCustomViews({
      customViews: [{ name: "メモ", url: "https://example.com" }],
    });
    expect(views[0]?.id).toBe("custom-view-1");
  });

  test("idが重複する場合はサフィックスで一意にする", () => {
    const { views } = resolveCustomViews({
      customViews: [
        { name: "Notes", url: "https://example.com" },
        { name: "notes", url: "https://example.org" },
      ],
    });
    expect(views.map((view) => view.id)).toEqual(["notes", "notes-2"]);
  });

  test("ワークスペース一覧のidは予約されている", () => {
    const { views } = resolveCustomViews({
      customViews: [{ id: "workspaces", name: "Workspaces", url: "https://example.com" }],
    });
    expect(views[0]?.id).toBe("workspaces-2");
  });

  test("handlersのキーがhandlerNamesになり、実体はidごとに引ける", () => {
    const { views, handlersById } = resolveCustomViews({
      customViews: [
        { name: "Notes", url: "https://example.com", handlers: { list: () => [], open: () => {} } },
      ],
    });
    expect(views[0]?.handlerNames).toEqual(["list", "open"]);
    expect(Object.keys(handlersById["notes"] ?? {})).toEqual(["list", "open"]);
  });

  test("関数でないhandlersの項目は警告付きで除外される", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const { views } = resolveCustomViews({
        customViews: [
          {
            name: "Notes",
            url: "https://example.com",
            handlers: { list: () => [], broken: "nope" as unknown as () => void },
          },
        ],
      });
      expect(views[0]?.handlerNames).toEqual(["list"]);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("pathとurlどちらも無効な要素は警告付きで飛ばされる", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const { views } = resolveCustomViews({
        customViews: [{ name: "Broken" }, { name: "Docs", url: "https://example.com" }],
      });
      expect(views.map((view) => view.id)).toEqual(["docs"]);
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

describe("resolveStatusBar", () => {
  const sourcesOf = (def: ReturnType<typeof resolveStatusBar>) =>
    def.components.map((entry) => [
      entry.id,
      entry.source === null
        ? "render"
        : `${entry.source.kind}:${"id" in entry.source ? entry.source.id : entry.source.name}`,
    ]);

  test("未指定なら既定の並び（左にモード、右にcwd）で出す", () => {
    const def = resolveStatusBar(null);
    expect(def.visible).toBe(true);
    expect(sourcesOf(def)).toEqual([
      ["left-0", "builtin:mode"],
      ["right-0", "builtin:cwd"],
    ]);
  });

  test("falseなら出さない", () => {
    expect(resolveStatusBar({ statusBar: false })).toEqual({
      visible: false,
      css: "",
      components: [],
    });
  });

  test("書いた区画だけ差し替え、書かなかった区画は既定の並びのまま", () => {
    const def = resolveStatusBar({
      statusBar: { right: ["tab-var:branch", { source: "builtin:board", prefix: "@" }] },
    });
    expect(sourcesOf(def)).toEqual([
      ["left-0", "builtin:mode"],
      ["right-0", "tab-var:branch"],
      ["right-1", "builtin:board"],
    ]);
    expect(def.components[2]?.prefix).toBe("@");
  });

  test("全区画を空にするとバー自体を出さない", () => {
    expect(resolveStatusBar({ statusBar: { left: [], right: [] } }).visible).toBe(false);
  });

  test("renderはsourceより優先し、intervalは下限へ切り上げて警告する", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const render = () => "x";
      const def = resolveStatusBar(
        {
          statusBar: {
            left: [],
            right: [
              { render, source: "builtin:cwd", interval: 10 },
              { render, interval: 1000 },
            ],
          },
        },
        diag,
      );
      expect(def.components.map((entry) => [entry.source, entry.interval])).toEqual([
        [null, STATUS_BAR_MIN_INTERVAL_MS],
        [null, 1000],
      ]);
      expect(diag.list().map((entry) => entry.scope)).toEqual(["statusBar.right[0].interval"]);
    } finally {
      restore();
    }
  });

  test("不正な部品だけ落として警告し、区画が配列でなければ既定の並びへ落とす", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const def = resolveStatusBar(
        {
          statusBar: {
            left: "builtin:mode" as never,
            right: ["builtin:nope", 42 as never, { render: "x" as never }, "tab-var:ok"],
          },
        },
        diag,
      );
      expect(sourcesOf(def)).toEqual([
        ["left-0", "builtin:mode"],
        ["right-3", "tab-var:ok"],
      ]);
      expect(diag.list().map((entry) => entry.scope)).toEqual([
        "statusBar.left",
        "statusBar.right[0].source",
        "statusBar.right[1]",
        "statusBar.right[2].render",
      ]);
    } finally {
      restore();
    }
  });

  test("idを付けた部品はそのidで、不正・重複・既定idの形は警告して区画-番号へ落とす", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const def = resolveStatusBar(
        {
          statusBar: {
            left: [{ id: "git", source: "tab-var:branch" }],
            right: [
              { id: "git", source: "builtin:cwd" },
              { id: "has space", source: "builtin:cwd" },
              { id: "left-0", source: "builtin:cwd" },
              { id: "clock_1", source: "builtin:board" },
            ],
          },
        },
        diag,
      );
      expect(def.components.map((entry) => entry.id)).toEqual([
        "git",
        "right-0",
        "right-1",
        "right-2",
        "clock_1",
      ]);
      expect(diag.list().map((entry) => entry.scope)).toEqual([
        "statusBar.right[0].id",
        "statusBar.right[1].id",
        "statusBar.right[2].id",
      ]);
    } finally {
      restore();
    }
  });
});

describe("resolveSidebarToolbar", () => {
  test("未指定なら右にコマンドパレットのボタンだけを出す", () => {
    const def = resolveSidebarToolbar(null);
    expect(def.visible).toBe(true);
    expect(def.components.map((entry) => [entry.id, entry.builtin])).toEqual([
      ["right-0", "command-palette"],
    ]);
  });

  test("falseなら出さない", () => {
    expect(resolveSidebarToolbar({ sidebar: { toolbar: false } })).toEqual({
      visible: false,
      css: "",
      components: [],
    });
  });

  test("固定のボタン・sourceの値・renderの値を並べ、書かなかった区画は既定のまま", () => {
    const run = () => {};
    const render = () => "x";
    const def = resolveSidebarToolbar({
      sidebar: {
        toolbar: {
          left: [
            { icon: "git-branch", tooltip: "lazygit", run },
            { icon: "power", action: "quit-app" },
            { icon: "git-branch", source: "tab-var:branch" },
            { render, interval: 1000 },
          ],
        },
      },
    });
    expect(
      def.components.map((entry) => ({
        id: entry.id,
        builtin: entry.builtin,
        icon: entry.icon,
        source: entry.source,
        render: entry.render !== undefined,
        run: entry.run !== undefined,
        action: entry.action,
      })),
    ).toEqual([
      {
        id: "left-0",
        builtin: null,
        icon: "git-branch",
        source: null,
        render: false,
        run: true,
        action: null,
      },
      {
        id: "left-1",
        builtin: null,
        icon: "power",
        source: null,
        render: false,
        run: false,
        action: "quit-app",
      },
      {
        id: "left-2",
        builtin: null,
        icon: "git-branch",
        source: { kind: "tab-var", name: "branch" },
        render: false,
        run: false,
        action: null,
      },
      {
        id: "left-3",
        builtin: null,
        icon: "",
        source: null,
        render: true,
        run: false,
        action: null,
      },
      {
        id: "right-0",
        builtin: "command-palette",
        icon: "",
        source: null,
        render: false,
        run: false,
        action: null,
      },
    ]);
    expect(def.components[3]?.interval).toBe(1000);
  });

  test("不正な部品だけ落として警告し、actionはrunと同時なら使わない", () => {
    const { diag, restore } = captureDiagnostics();
    try {
      const run = () => {};
      const def = resolveSidebarToolbar(
        {
          sidebar: {
            toolbar: {
              left: [
                "builtin:mode",
                { tooltip: "中身が無い" },
                { icon: "x", action: "no-such-action" as never },
                { icon: "y", action: "quit-app", run },
                { label: "固定", source: "builtin:cwd" },
              ],
              right: [],
            },
          },
        },
        diag,
      );
      expect(def.components.map((entry) => [entry.id, entry.action, entry.label])).toEqual([
        ["left-2", null, ""],
        ["left-3", null, ""],
        ["left-4", null, ""],
      ]);
      expect(diag.list().map((entry) => entry.scope)).toEqual([
        "sidebar.toolbar.left[0].source",
        "sidebar.toolbar.left[1]",
        "sidebar.toolbar.left[2].action",
        "sidebar.toolbar.left[3].action",
        "sidebar.toolbar.left[4]",
      ]);
    } finally {
      restore();
    }
  });

  test("全区画を空にするとツールバー自体を出さない", () => {
    expect(resolveSidebarToolbar({ sidebar: { toolbar: { left: [], right: [] } } }).visible).toBe(
      false,
    );
  });
});
