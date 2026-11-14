// 現在有効な設定値の一覧（IPCの/config → CLIの`niwa config show`、RPCのconfigメッセージ →
// webviewの設定モーダル）用の正規化。解決済みの各設定は型も既定値の持ち方もバラバラなため、
// 表示側が並べるだけで済む「セクション → key/value」の一本の形へ均す。
//
// 値として見せられない設定は含めない（mouse.selectionMenu・niwa.on等の関数、
// キーバインドの個々のエントリは`niwa keybind list`の担当）。
// worktree設定もここには出ない: 解決はCLIプロセス側でプロジェクトローカル設定と
// 混ぜて行うため、アプリが保持している「現在の値」が存在しない。

import type {
  KeybindingsConfig,
  LayoutsConfig,
  ResolvedAppearanceConfig,
  ResolvedBoardConfig,
  ResolvedBrowserConfig,
  ResolvedCommandTemplateConfig,
  ResolvedCustomViewConfig,
  ResolvedLinkConfig,
  ResolvedMouseConfig,
  ResolvedResumeConfig,
  ResolvedSidebarConfig,
  ResolvedTerminalConfig,
  ResolvedUiColors,
  ShellProfile,
} from "@niwaterm/config";
import { formatSidebarBoardStatusSource } from "@niwaterm/config";
import type { ConfigDiagnostic } from "./config-diagnostics";
import { buildKeybindList } from "./keybind-list";
import type { SidebarToolbarDefinition, SidebarToolbarEntry } from "./sidebar-toolbar";
import type { ComponentEntry, StatusBarDefinition } from "./status-bar";

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
  /**
   * 直近の読み込み試行が失敗した理由。成功・ファイル不在ならnull。
   * configFileLoadedがtrueのままこれが入っているときは、読み込めていた頃の設定で動き続けている
   */
  loadError: string | null;
  /** 既定値へ落とした項目・無視した項目。設定したのに効かない原因の手がかり */
  diagnostics: ConfigDiagnostic[];
  sections: ConfigSummarySection[];
}

export interface ConfigSummaryInput {
  configFile: string;
  configFileLoaded: boolean;
  loadError: string | null;
  diagnostics: ConfigDiagnostic[];
  /** 実行時ズームを反映した実効値 */
  appearance: ResolvedAppearanceConfig;
  /** ズームを掛ける前の、設定ファイル由来のフォントサイズ */
  baseFontSize: number;
  /** ズームを掛ける前の、設定ファイル由来の行の高さ */
  baseLineHeight: number;
  keybindings: KeybindingsConfig;
  browser: ResolvedBrowserConfig;
  customViews: ResolvedCustomViewConfig[];
  commandTemplates: ResolvedCommandTemplateConfig[];
  defaultShell: string | undefined;
  shellProfiles: ShellProfile[];
  layouts: LayoutsConfig;
  mouse: ResolvedMouseConfig;
  link: ResolvedLinkConfig;
  workspaceDefaultCwd: string | undefined;
  board: ResolvedBoardConfig;
  resume: ResolvedResumeConfig;
  sidebar: ResolvedSidebarConfig;
  terminal: ResolvedTerminalConfig;
  statusBar: StatusBarDefinition;
  sidebarToolbar: SidebarToolbarDefinition;
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

/**
 * UIの詳細配色。appearanceの他の項目と同じセクションへ並べるが、設定ファイル上は
 * appearance.uiのネストなのでkeyへ"ui."を付けて出どころを示す
 */
function uiColorEntries(ui: ResolvedUiColors): ConfigSummaryEntry[] {
  return (Object.keys(ui) as (keyof ResolvedUiColors)[]).map((key) => ({
    key: `ui.${key}`,
    value: ui[key],
    swatches: [ui[key]],
  }));
}

function appearanceSection(
  appearance: ResolvedAppearanceConfig,
  baseFontSize: number,
  baseLineHeight: number,
): ConfigSummarySection {
  return {
    name: "appearance",
    entries: [
      { key: "theme", value: appearance.theme },
      { key: "fontFamily", value: appearance.fontFamily },
      fontSizeEntry(appearance.fontSize, baseFontSize),
      lineHeightEntry(appearance.lineHeight, baseLineHeight),
      { key: "foreground", value: appearance.foreground, swatches: [appearance.foreground] },
      { key: "background", value: appearance.background, swatches: [appearance.background] },
      { key: "cursor", value: appearance.cursor, swatches: [appearance.cursor] },
      { key: "backgroundOpacity", value: String(appearance.backgroundOpacity) },
      backgroundImageEntry(appearance.backgroundImage),
      {
        key: "ansiColors",
        value: appearance.ansiColors.join(" "),
        swatches: [...appearance.ansiColors],
      },
      { key: "tabBar", value: appearance.tabBar },
      { key: "popupToolbar", value: appearance.popupToolbar },
      { key: "titleBar", value: appearance.titleBar },
      { key: "tileBorderRadius", value: `${appearance.tileBorderRadius}px` },
      { key: "tileGap", value: `${appearance.tileGap}px` },
      { key: "inactiveTileDim", value: String(appearance.inactiveTileDim) },
      { key: "tileShadow", value: appearance.tileShadow },
      { key: "tileAnimation", value: String(appearance.tileAnimation) },
      ...uiColorEntries(appearance.ui),
    ],
  };
}

/**
 * キーバインドは件数とprefixだけを出す。個々の割り当ては`niwa keybind list`の担当で、
 * ここへ並べると他の設定が埋もれる。件数は実際に発火するものだけを数える（keybind listと同じ基準）
 */
function keybindingsSection(keybindings: KeybindingsConfig): ConfigSummarySection {
  const list = buildKeybindList(keybindings);
  const prefixEntries = list.entries.filter((e) => !e.noPrefix).length;
  const directEntries = list.entries.filter((e) => e.noPrefix && e.mode === undefined).length;
  const copyModeEntries = list.entries.filter((e) => e.mode === "copy").length;
  const copyModeSearchEntries = list.entries.filter((e) => e.mode === "copy-search").length;
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
        note: "一覧は niwa keybind list",
      },
      { key: "direct", value: `${directEntries}件`, note: "prefix不要で即時発火するバインド" },
      { key: "copyMode", value: `${copyModeEntries}件`, note: "コピーモード中のバインド" },
      {
        key: "copyModeSearch",
        value: `${copyModeSearchEntries}件`,
        note: "コピーモードで検索文字列を入力している間のバインド",
      },
    ],
  };
}

function statusBarComponentValue(entry: ComponentEntry): string {
  if (entry.source === null) {
    return entry.interval === null ? "render" : `render (${entry.interval}msごと)`;
  }
  return entry.source.kind === "builtin"
    ? `builtin:${entry.source.id}`
    : `tab-var:${entry.source.name}`;
}

/** 部品はidをキーに並べる。`niwa status-bar refresh --item`で指す名前をここで引けるようにする */
function statusBarSection(statusBar: StatusBarDefinition): ConfigSummarySection {
  if (!statusBar.visible) {
    return {
      name: "statusBar",
      entries: [
        { key: "items", value: "(なし)", note: "statusBar: falseか全区画が空のため出さない" },
      ],
    };
  }
  return {
    name: "statusBar",
    entries: statusBar.components.map((entry) => ({
      key: entry.id,
      value: statusBarComponentValue(entry),
      note: entry.run === undefined ? entry.section : `${entry.section}・押せる`,
    })),
  };
}

function sidebarToolbarComponentValue(entry: SidebarToolbarEntry): string {
  if (entry.builtin !== null) return `builtin:${entry.builtin}`;
  if (entry.render !== undefined || entry.source !== null) return statusBarComponentValue(entry);
  if (entry.label !== "") return entry.label;
  if (entry.html !== "") return "html";
  return `icon:${entry.icon}`;
}

function sidebarToolbarComponentNote(entry: SidebarToolbarEntry): string {
  if (entry.action !== null) return `${entry.section}・${entry.action}`;
  return entry.run === undefined ? entry.section : `${entry.section}・押せる`;
}

function sidebarToolbarEntries(toolbar: SidebarToolbarDefinition): ConfigSummaryEntry[] {
  if (!toolbar.visible) {
    return [{ key: "toolbar", value: "(なし)", note: "toolbar: falseか全区画が空のため出さない" }];
  }
  return toolbar.components.map((entry) => ({
    key: `toolbar.${entry.id}`,
    value: sidebarToolbarComponentValue(entry),
    note: sidebarToolbarComponentNote(entry),
  }));
}

function commandTemplatesSection(templates: ResolvedCommandTemplateConfig[]): ConfigSummarySection {
  if (templates.length === 0) {
    return {
      name: "commandTemplates",
      entries: [{ key: "templates", value: UNSET, note: "1つも設定されていないため機能オフ" }],
    };
  }
  // キーをidにするのは、niwa.commandTemplate.open(id)へ渡す値をここで確かめられるようにするため
  return {
    name: "commandTemplates",
    entries: templates.map((template) => ({
      key: template.id,
      value: template.name,
      note: template.command,
    })),
  };
}

function customViewsSection(customViews: ResolvedCustomViewConfig[]): ConfigSummarySection {
  if (customViews.length === 0) {
    return {
      name: "customViews",
      entries: [{ key: "views", value: UNSET, note: "1つも設定されていないため機能オフ" }],
    };
  }
  return {
    name: "customViews",
    entries: customViews.map((view) => ({
      key: view.id,
      value: `${view.name} (${view.url})`,
      note:
        view.handlerNames.length > 0
          ? `handlers: ${view.handlerNames.join(", ")}`
          : "HTML側から呼べる関数は未設定",
    })),
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
            note: "詳細は niwa shell-profile list",
          },
    ],
  };
}

export function buildConfigSummary(input: ConfigSummaryInput): ConfigSummary {
  const layoutNames = Object.keys(input.layouts);
  return {
    configFile: input.configFile,
    configFileLoaded: input.configFileLoaded,
    loadError: input.loadError,
    diagnostics: input.diagnostics,
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
                note: "グローバル設定のみ。プロジェクトローカル分は niwa layout list",
              },
        ],
      },
      { name: "browser", entries: [{ key: "defaultUrl", value: input.browser.defaultUrl }] },
      {
        name: "board",
        entries: [
          { key: "newTabCwd", value: input.board.newTabCwd },
          {
            key: "naming",
            value: input.board.naming,
            ...(input.board.naming === "directory-follow"
              ? { note: "cwdをOSC 7で報告するシェルでのみ追従する" }
              : {}),
          },
          input.board.phases.length === 0
            ? { key: "phases", value: "(なし)" }
            : {
                key: "phases",
                value: input.board.phases.map((phase) => phase.id).join(", "),
              },
        ],
      },
      {
        name: "resume",
        entries: [
          {
            key: "enabled",
            value: String(input.resume.enabled),
            note: "レイアウトプリセットで組み直さないBoardの既定。Boardごとの切り替えが優先",
          },
          input.resume.allow.length === 0
            ? { key: "allow", value: "(なし)", note: "何も打ち直さない" }
            : { key: "allow", value: input.resume.allow.join(", ") },
        ],
      },
      {
        name: "sidebar",
        entries: [
          input.sidebar.boardStatus.length === 0
            ? {
                key: "boardStatus",
                value: "(なし)",
                note: "Board行にステータスラインを出さない",
              }
            : {
                key: "boardStatus",
                value: input.sidebar.boardStatus
                  .map((item) => formatSidebarBoardStatusSource(item.source))
                  .join(", "),
              },
          ...sidebarToolbarEntries(input.sidebarToolbar),
        ],
      },
      {
        name: "terminal",
        entries: [
          {
            key: "scrollback",
            value: `${input.terminal.scrollback}行`,
            // 刈り込みがページ単位で実際に遡れる行数は指定値より多くなる。
            // 値だけを出すと「設定より多く残っている」と見えてしまう
            note: "実際に遡れる行数はこれより数十〜数百行多くなる（刈り込みがページ単位のため）",
          },
        ],
      },
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
        entries: [
          { key: "copyOnSelect", value: String(input.mouse.copyOnSelect) },
          { key: "copyModeOnSelect", value: String(input.mouse.copyModeOnSelect) },
        ],
      },
      {
        name: "link",
        entries: [
          { key: "modifier", value: input.link.modifier },
          { key: "open", value: input.link.open },
          {
            key: "rules",
            value: `${input.link.rules.length}件`,
            // パターンそのものを並べると一覧が正規表現で埋まるため、件数と中身は別行に分ける
            note: input.link.rules.map((rule) => `/${rule.source}/${rule.flags}`).join(" "),
          },
        ],
      },
      statusBarSection(input.statusBar),
      customViewsSection(input.customViews),
      commandTemplatesSection(input.commandTemplates),
    ],
  };
}
