// 現在有効な設定値の一覧（IPCの/config → CLIの`niwaterm config show`、RPCのconfigメッセージ →
// webviewの設定モーダル）用の正規化。解決済みの各設定は型も既定値の持ち方もバラバラなため、
// 表示側が並べるだけで済む「セクション → key/value」の一本の形へ均す。
//
// 値として見せられない設定は含めない（mouse.selectionMenu・niwa.on等の関数、
// キーバインドの個々のエントリは`niwaterm keybind list`の担当）。
// worktree設定もここには出ない: 解決はCLIプロセス側でプロジェクトローカル設定と
// 混ぜて行うため、アプリが保持している「現在の値」が存在しない。

import type {
  KeybindingsConfig,
  LayoutsConfig,
  ResolvedAppearanceConfig,
  ResolvedBoardConfig,
  ResolvedBrowserConfig,
  ResolvedCustomViewConfig,
  ResolvedMouseConfig,
  ShellProfile,
} from "@niwaterm/config";
import { buildKeybindList } from "./keybind-list";

/** 値が無い項目の表示。未設定でも既定値で動く項目はnoteへフォールバック先を書く */
const UNSET = "(未設定)";

export interface ConfigSummaryEntry {
  /** 設定ファイルでのフィールド名（セクション名は含めない） */
  key: string;
  value: string;
  /** 値だけでは分からない補足（フォールバック先・ズーム量など） */
  note?: string;
  /** 色として見せられる値。単色は1要素、ANSIパレットは16要素 */
  swatches?: string[];
}

export interface ConfigSummarySection {
  /** 設定ファイルのトップレベルキー名。設定ファイルのどこを直せばよいかの手がかりにする */
  name: string;
  entries: ConfigSummaryEntry[];
}

export interface ConfigSummary {
  /** 読み込み対象の設定ファイルのパス */
  configFile: string;
  /** 読み込めたか。falseならファイル不在か読み込み失敗で、全項目が既定値 */
  configFileLoaded: boolean;
  sections: ConfigSummarySection[];
}

export interface ConfigSummaryInput {
  configFile: string;
  configFileLoaded: boolean;
  /** 実行時ズームを反映した実効値 */
  appearance: ResolvedAppearanceConfig;
  /** ズームを掛ける前の、設定ファイル由来のフォントサイズ */
  baseFontSize: number;
  /** ズームを掛ける前の、設定ファイル由来の行の高さ */
  baseLineHeight: number;
  keybindings: KeybindingsConfig;
  browser: ResolvedBrowserConfig;
  customView: ResolvedCustomViewConfig | null;
  defaultShell: string | undefined;
  shellProfiles: ShellProfile[];
  layouts: LayoutsConfig;
  mouse: ResolvedMouseConfig;
  workspaceDefaultCwd: string | undefined;
  board: ResolvedBoardConfig;
}

/** background-imageの値がdata URIとして埋め込まれた画像かどうかと、そのMIMEタイプ */
const EMBEDDED_IMAGE = /^url\(["']?data:([^;,]+)[;,]/;

function formatSize(chars: number): string {
  return chars < 1024 ? `${chars}B` : `${Math.round(chars / 1024)}KB`;
}

/**
 * 画像パス指定のbackgroundImageは解決時にdata URIへ変換済みで数百KBになりうる。
 * そのまま並べると一覧が埋まるため、MIMEタイプとサイズだけに畳む
 */
function backgroundImageEntry(value: string): ConfigSummaryEntry {
  const mime = EMBEDDED_IMAGE.exec(value)?.[1];
  if (mime === undefined) return { key: "backgroundImage", value };
  return {
    key: "backgroundImage",
    value: `(埋め込み画像: ${mime})`,
    note: `data URI ${formatSize(value.length)}`,
  };
}

/**
 * 実効フォントサイズ。キーバインド・CLIでのズームは設定ファイルを書き換えないため、
 * 設定ファイルを見ても今の値が分からない。ズーム中はその差分を添える
 */
function fontSizeEntry(effective: number, base: number): ConfigSummaryEntry {
  if (effective === base) return { key: "fontSize", value: `${effective}px` };
  const delta = effective - base;
  return {
    key: "fontSize",
    value: `${effective}px`,
    note: `設定値 ${base}px + ズーム ${delta > 0 ? "+" : ""}${delta}`,
  };
}

/**
 * 実効行高。フォントサイズのズームに追従して変わるため、設定ファイルの値と食い違う。
 * ズーム中はどこから来た値なのかが分かるよう設定値を添える
 */
function lineHeightEntry(effective: number, base: number): ConfigSummaryEntry {
  if (effective === base) return { key: "lineHeight", value: String(effective) };
  return {
    key: "lineHeight",
    value: String(effective),
    note: `設定値 ${base} をfontSizeのズームで拡大`,
  };
}

function appearanceSection(
  appearance: ResolvedAppearanceConfig,
  baseFontSize: number,
  baseLineHeight: number,
): ConfigSummarySection {
  return {
    name: "appearance",
    entries: [
      { key: "fontFamily", value: appearance.fontFamily },
      fontSizeEntry(appearance.fontSize, baseFontSize),
      lineHeightEntry(appearance.lineHeight, baseLineHeight),
      { key: "foreground", value: appearance.foreground, swatches: [appearance.foreground] },
      { key: "background", value: appearance.background, swatches: [appearance.background] },
      { key: "backgroundOpacity", value: String(appearance.backgroundOpacity) },
      backgroundImageEntry(appearance.backgroundImage),
      {
        key: "ansiColors",
        value: appearance.ansiColors.join(" "),
        swatches: [...appearance.ansiColors],
      },
      { key: "tabBar", value: appearance.tabBar },
      { key: "titleBar", value: appearance.titleBar },
    ],
  };
}

/**
 * キーバインドは件数とprefixだけを出す。個々の割り当ては`niwaterm keybind list`の担当で、
 * ここへ並べると他の設定が埋もれる。件数は実際に発火するものだけを数える（keybind listと同じ基準）
 */
function keybindingsSection(keybindings: KeybindingsConfig): ConfigSummarySection {
  const list = buildKeybindList(keybindings);
  const prefixEntries = list.entries.filter((e) => !e.noPrefix).length;
  const directEntries = list.entries.length - prefixEntries;
  return {
    name: "keybindings",
    entries: [
      list.prefix === null
        ? { key: "prefix", value: UNSET, note: "prefixを介するバインドは発火しない" }
        : { key: "prefix", value: list.prefix },
      { key: "repeatTimeoutMs", value: String(list.repeatTimeoutMs) },
      {
        key: "bindings",
        value: `${prefixEntries}件`,
        note: "一覧は niwaterm keybind list",
      },
      { key: "direct", value: `${directEntries}件`, note: "prefix不要で即時発火するバインド" },
    ],
  };
}

function customViewSection(customView: ResolvedCustomViewConfig | null): ConfigSummarySection {
  if (!customView) {
    return {
      name: "customView",
      entries: [
        { key: "name", value: UNSET, note: "path・urlのどちらも未設定のため機能オフ" },
        { key: "url", value: UNSET },
      ],
    };
  }
  return {
    name: "customView",
    entries: [
      { key: "name", value: customView.name },
      { key: "url", value: customView.url },
      {
        key: "handlers",
        value: customView.handlerNames.length > 0 ? customView.handlerNames.join(", ") : UNSET,
        note: "HTML側のniwaterm.callで呼べる関数",
      },
    ],
  };
}

function shellSection(
  defaultShell: string | undefined,
  profiles: ShellProfile[],
): ConfigSummarySection {
  return {
    name: "shell",
    entries: [
      defaultShell === undefined
        ? {
            key: "default",
            value: UNSET,
            note: "OS標準シェル（macOS/Linux: /bin/zsh、Windows: powershell.exe）",
          }
        : { key: "default", value: defaultShell },
      profiles.length === 0
        ? { key: "profiles", value: "(なし)" }
        : {
            key: "profiles",
            value: profiles.map((p) => p.id).join(", "),
            note: "詳細は niwaterm shell-profiles",
          },
    ],
  };
}

export function buildConfigSummary(input: ConfigSummaryInput): ConfigSummary {
  const layoutNames = Object.keys(input.layouts);
  return {
    configFile: input.configFile,
    configFileLoaded: input.configFileLoaded,
    sections: [
      appearanceSection(input.appearance, input.baseFontSize, input.baseLineHeight),
      keybindingsSection(input.keybindings),
      shellSection(input.defaultShell, input.shellProfiles),
      {
        name: "layouts",
        entries: [
          layoutNames.length === 0
            ? { key: "presets", value: "(なし)" }
            : {
                key: "presets",
                value: layoutNames.join(", "),
                // プロジェクトローカル（<repoRoot>/.niwaterm/config.ts）のプリセットは
                // cwd依存で解決されるため、アプリが常時保持しているグローバル分だけを出す
                note: "グローバル設定のみ。プロジェクトローカル分は niwaterm layout list",
              },
        ],
      },
      { name: "browser", entries: [{ key: "defaultUrl", value: input.browser.defaultUrl }] },
      { name: "board", entries: [{ key: "newTabCwd", value: input.board.newTabCwd }] },
      {
        name: "workspace",
        entries: [
          input.workspaceDefaultCwd === undefined
            ? { key: "defaultCwd", value: UNSET, note: "OS標準のホームディレクトリ" }
            : { key: "defaultCwd", value: input.workspaceDefaultCwd },
        ],
      },
      {
        name: "mouse",
        entries: [{ key: "copyOnSelect", value: String(input.mouse.copyOnSelect) }],
      },
      customViewSection(input.customView),
    ],
  };
}
