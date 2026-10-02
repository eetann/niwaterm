import { describe, expect, test } from "bun:test";
import {
  defaultAppearance,
  defaultBoardConfig,
  defaultResumeConfig,
  defaultBrowserConfig,
  defaultMouseConfig,
  defaultSidebarConfig,
  defaultTerminalConfig,
  defaultUiColors,
} from "@niwaterm/config";
import { buildConfigSummary, type ConfigSummary, type ConfigSummaryInput } from "./config-summary";

function input(overrides: Partial<ConfigSummaryInput> = {}): ConfigSummaryInput {
  return {
    configFile: "/home/user/.config/niwaterm/niwaterm.config.ts",
    configFileLoaded: true,
    loadError: null,
    diagnostics: [],
    appearance: defaultAppearance,
    baseFontSize: defaultAppearance.fontSize,
    baseLineHeight: defaultAppearance.lineHeight,
    keybindings: { prefix: "ctrl+b", bindings: { d: "split-vertical" } },
    browser: defaultBrowserConfig,
    customViews: [],
    defaultShell: undefined,
    shellProfiles: [],
    layouts: {},
    mouse: defaultMouseConfig,
    link: {
      rules: [{ source: "https?://\\S+", flags: "", format: "$0" }],
      modifier: "cmd",
      open: "external",
    },
    workspaceDefaultCwd: undefined,
    board: defaultBoardConfig,
    resume: defaultResumeConfig,
    sidebar: defaultSidebarConfig,
    terminal: defaultTerminalConfig,
    statusBar: { visible: false, css: "", components: [] },
    ...overrides,
  };
}

function entry(summary: ConfigSummary, section: string, key: string) {
  return summary.sections.find((s) => s.name === section)?.entries.find((e) => e.key === key);
}

describe("buildConfigSummary", () => {
  test("設定ファイルのパスと読み込み結果をそのまま返す", () => {
    const summary = buildConfigSummary(input({ configFileLoaded: false }));
    expect(summary.configFile).toBe("/home/user/.config/niwaterm/niwaterm.config.ts");
    expect(summary.configFileLoaded).toBe(false);
  });

  test("読み込みエラーと無視した項目の診断をそのまま通す", () => {
    const diagnostics = [
      { level: "warn" as const, scope: "appearance.fontSize", message: "値が不正なため既定値" },
    ];
    const summary = buildConfigSummary(input({ loadError: "SyntaxError: ...", diagnostics }));
    expect(summary.loadError).toBe("SyntaxError: ...");
    expect(summary.diagnostics).toEqual(diagnostics);
  });

  test("セクション名は設定ファイルのトップレベルキーと同じ", () => {
    const names = buildConfigSummary(input()).sections.map((s) => s.name);
    expect(names).toEqual([
      "appearance",
      "keybindings",
      "shell",
      "layouts",
      "browser",
      "board",
      "resume",
      "sidebar",
      "terminal",
      "workspace",
      "mouse",
      "link",
      "statusBar",
      "customViews",
    ]);
  });

  test("ズーム中のfontSizeは実効値を出し、設定値との差分をnoteへ添える", () => {
    const appearance = { ...defaultAppearance, fontSize: 16 };
    const summary = buildConfigSummary(input({ appearance, baseFontSize: 13 }));
    expect(entry(summary, "appearance", "fontSize")).toEqual({
      key: "fontSize",
      value: "16px",
      note: "設定値 13px + ズーム +3",
    });
  });

  test("ズームしていなければfontSizeにnoteは付かない", () => {
    const summary = buildConfigSummary(input());
    expect(entry(summary, "appearance", "fontSize")).toEqual({
      key: "fontSize",
      value: "13px",
    });
  });

  test("ズーム中のlineHeightは実効値を出し、設定値をnoteへ添える", () => {
    const appearance = { ...defaultAppearance, lineHeight: 22 };
    const summary = buildConfigSummary(input({ appearance, baseLineHeight: 18 }));
    expect(entry(summary, "appearance", "lineHeight")).toEqual({
      key: "lineHeight",
      value: "22",
      note: "設定値 18 をfontSizeのズームで拡大",
    });
  });

  test("ズームしていなければlineHeightにnoteは付かない", () => {
    const summary = buildConfigSummary(input());
    expect(entry(summary, "appearance", "lineHeight")).toEqual({
      key: "lineHeight",
      value: "18",
    });
  });

  test("色の項目はswatchesを持ち、ansiColorsは16色ぶん並ぶ", () => {
    const summary = buildConfigSummary(input());
    expect(entry(summary, "appearance", "background")?.swatches).toEqual(["#1e1e2e"]);
    expect(entry(summary, "appearance", "ansiColors")?.swatches).toHaveLength(16);
  });

  test("appearance.uiの各色はui.付きのkeyでappearanceセクションへ並ぶ", () => {
    const appearance = {
      ...defaultAppearance,
      ui: { ...defaultUiColors, accent: "#ff0000" },
    };
    const summary = buildConfigSummary(input({ appearance }));
    expect(entry(summary, "appearance", "ui.accent")).toEqual({
      key: "ui.accent",
      value: "#ff0000",
      swatches: ["#ff0000"],
    });
    expect(entry(summary, "appearance", "ui.border")?.value).toBe(defaultUiColors.border);
  });

  test("data URIへ埋め込まれた背景画像はMIMEタイプとサイズへ畳む", () => {
    const appearance = {
      ...defaultAppearance,
      backgroundImage: `url("data:image/png;base64,${"A".repeat(2048)}")`,
    };
    expect(
      entry(buildConfigSummary(input({ appearance })), "appearance", "backgroundImage"),
    ).toEqual({
      key: "backgroundImage",
      value: "(埋め込み画像: image/png)",
      note: "data URI 2KB",
    });
  });

  test("CSS関数形式の背景画像はそのまま出す", () => {
    const appearance = { ...defaultAppearance, backgroundImage: "linear-gradient(red, blue)" };
    expect(
      entry(buildConfigSummary(input({ appearance })), "appearance", "backgroundImage"),
    ).toEqual({ key: "backgroundImage", value: "linear-gradient(red, blue)" });
  });

  test("キーバインドは実際に発火するものだけを件数で出す", () => {
    const summary = buildConfigSummary(
      input({
        keybindings: {
          prefix: "ctrl+b",
          // ctrl修飾は2打目キーとして無効なので件数に入らない
          bindings: { d: "split-vertical", "ctrl+x": "close-tile" },
          direct: { "ctrl+shift+c": "copy-selection" },
        },
      }),
    );
    expect(entry(summary, "keybindings", "prefix")?.value).toBe("ctrl+b");
    expect(entry(summary, "keybindings", "bindings")?.value).toBe("1件");
    expect(entry(summary, "keybindings", "direct")?.value).toBe("1件");
  });

  test("prefix未設定は発火しない旨のnoteを添える", () => {
    const summary = buildConfigSummary(input({ keybindings: {} }));
    expect(entry(summary, "keybindings", "prefix")).toEqual({
      key: "prefix",
      value: "(未設定)",
      note: "prefixを介するバインドは発火しない",
    });
  });

  test("未設定でも既定値で動く項目はフォールバック先をnoteへ書く", () => {
    const summary = buildConfigSummary(input());
    expect(entry(summary, "shell", "default")?.value).toBe("(未設定)");
    expect(entry(summary, "shell", "default")?.note).toContain("OS標準シェル");
    expect(entry(summary, "workspace", "defaultCwd")?.note).toBe("OS標準のホームディレクトリ");
  });

  test("シェルプロファイルはidを並べる", () => {
    const summary = buildConfigSummary(
      input({
        shellProfiles: [
          { id: "wsl-NixOS", name: "NixOS", command: "wsl.exe -d NixOS" },
          { id: "pwsh", name: "PowerShell", command: "powershell.exe" },
        ],
      }),
    );
    expect(entry(summary, "shell", "profiles")?.value).toBe("wsl-NixOS, pwsh");
  });

  test("レイアウトプリセットは名前を並べ、無ければ(なし)", () => {
    expect(entry(buildConfigSummary(input()), "layouts", "presets")?.value).toBe("(なし)");
    const summary = buildConfigSummary(
      input({ layouts: { dev: { layout: { kind: "tile", tabs: [] } } } }),
    );
    expect(entry(summary, "layouts", "presets")?.value).toBe("dev");
  });

  test("customViewが1つも無くても行を残す（機能オフだと分かるようにする）", () => {
    const summary = buildConfigSummary(input());
    expect(entry(summary, "customViews", "views")?.value).toBe("(未設定)");
  });

  test("customViewはidをキーに名前とURLを並べる", () => {
    const summary = buildConfigSummary(
      input({
        customViews: [
          { id: "notes", name: "Notes", url: "file:///home/user/notes.html", handlerNames: [] },
          {
            id: "worktrees",
            name: "Worktrees",
            url: "file:///home/user/worktrees.html",
            handlerNames: ["list", "open"],
          },
        ],
      }),
    );
    expect(entry(summary, "customViews", "notes")?.value).toBe(
      "Notes (file:///home/user/notes.html)",
    );
    expect(entry(summary, "customViews", "worktrees")?.note).toBe("handlers: list, open");
  });
  test("関数で指定する設定（mouse.selectionMenu）は含めない", () => {
    const summary = buildConfigSummary(input());
    const mouseKeys = summary.sections.find((s) => s.name === "mouse")?.entries.map((e) => e.key);
    expect(mouseKeys).toEqual(["copyOnSelect"]);
  });

  test("terminal.scrollbackは行数と刈り込み単位の注記を添えて出す", () => {
    const summary = buildConfigSummary(input({ terminal: { scrollback: 50_000 } }));
    expect(entry(summary, "terminal", "scrollback")).toEqual({
      key: "scrollback",
      value: "50000行",
      note: "実際に遡れる行数はこれより数十〜数百行多くなる（刈り込みがページ単位のため）",
    });
  });
});

describe("buildConfigSummary statusBar", () => {
  const base = {
    section: "right" as const,
    render: undefined,
    interval: null,
    prefix: "",
    color: "",
    tooltip: "",
    run: undefined,
  };

  test("部品をidをキーに、出どころと区画・押せるかを並べる", () => {
    const summary = buildConfigSummary(
      input({
        statusBar: {
          visible: true,
          css: "",
          components: [
            { ...base, id: "left-0", section: "left", source: { kind: "builtin", id: "mode" } },
            { ...base, id: "git", source: { kind: "tab-var", name: "branch" }, run: () => {} },
            { ...base, id: "clock", source: null, render: () => "", interval: 1000 },
          ],
        },
      }),
    );
    expect(summary.sections.find((s) => s.name === "statusBar")?.entries).toEqual([
      { key: "left-0", value: "builtin:mode", note: "left" },
      { key: "git", value: "tab-var:branch", note: "right・押せる" },
      { key: "clock", value: "render (1000msごと)", note: "right" },
    ]);
  });

  test("出さない設定では部品の代わりにその旨を出す", () => {
    const summary = buildConfigSummary(input());
    expect(entry(summary, "statusBar", "items")?.value).toBe("(なし)");
  });
});
