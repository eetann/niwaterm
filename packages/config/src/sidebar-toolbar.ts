// サイドバー上端のツールバーの設定。ステータスバー（status-bar.ts）と同じ部品の書き方で、
// 左・右の2区画へボタンや表示を並べる。サイドバーは幅が狭いため中央の区画は持たない。
//
// 部品の中身は、固定のボタン（icon・label・html）か、ステータスバーと同じsource・renderの値。
// render・runはbun側でしか呼べないため、webviewへは部品のidと評価後の文字列だけを渡す。
// actionはwebview側で処理するキーバインドのアクションなので、名前のままwebviewへ渡す。

import type { KeybindAction } from "./keybindings";
import type { StatusBarComponentConfig } from "./status-bar";

/** 部品を並べる区画 */
export type SidebarToolbarSection = "left" | "right";

export const SIDEBAR_TOOLBAR_SECTIONS: readonly SidebarToolbarSection[] = ["left", "right"];

/**
 * ツールバー専用のビルトイン部品。
 * - command-palette: コマンドパレットを開くボタン
 */
export type SidebarToolbarBuiltin = "command-palette";

const SIDEBAR_TOOLBAR_BUILTINS: readonly SidebarToolbarBuiltin[] = ["command-palette"];

const BUILTIN_PREFIX = "builtin:";

export interface SidebarToolbarComponentConfig extends StatusBarComponentConfig {
  /**
   * `builtin:command-palette`か、ステータスバーと同じ`builtin:cwd` / `builtin:workspace` /
   * `builtin:board` / `tab-var:<name>`（`builtin:mode`は使えない）
   */
  source?: string;
  /** 先頭に出すアイコン。lucide（https://lucide.dev/icons/）のアイコン名をkebab-caseで書く */
  icon?: string;
  /** ボタンに出す文字。source・renderを書いた部品では使わない（値が出る） */
  label?: string;
  /**
   * labelの代わりに出すHTML。source・renderを書いた部品では使わない。
   * 外部から来た文字列を埋め込むときはユーザー側でエスケープすること
   */
  html?: string;
  /** 押した時に実行するキーバインドのアクション（`quit-app`等）。runと同時には書けない（runが優先される） */
  action?: KeybindAction;
}

/** 文字列だけで書いた場合はsourceだけを指定したのと同じ */
export type SidebarToolbarComponent = string | SidebarToolbarComponentConfig;

export interface SidebarToolbarConfig {
  /** 左端から並べる部品。省略時はDEFAULT_SIDEBAR_TOOLBAR.left */
  left?: SidebarToolbarComponent[];
  /** 右端へ寄せて並べる部品。省略時はDEFAULT_SIDEBAR_TOOLBAR.right */
  right?: SidebarToolbarComponent[];
  /** 部品のhtmlから参照するCSS。webviewの<style>へそのまま入る */
  css?: string;
}

/** webviewへ渡す部品1件。関数を除き、描き方の判断に要るものだけを持つ */
export interface ResolvedSidebarToolbarItem {
  id: string;
  /** ビルトインの部品ならそのid。webview側で描く */
  builtin: SidebarToolbarBuiltin | null;
  /** lucideのアイコン名（kebab-case）。未指定は空文字列 */
  icon: string;
  /** 固定の文字。未指定は空文字列 */
  label: string;
  /** 固定のHTML。未指定は空文字列 */
  html: string;
  /** 未指定は空文字列 */
  tooltip: string;
  /** 未指定は空文字列 */
  color: string;
  /** 値（statusBarValuesと同じ形）をbun側から受け取って出すか。trueならlabel・htmlは使わない */
  dynamic: boolean;
  /** runを持つか。押した時にbunへ伝える */
  runnable: boolean;
  /** 押した時にwebview側で実行するアクション。未指定はnull */
  action: KeybindAction | null;
}

export interface ResolvedSidebarToolbarConfig {
  /** falseならツールバーを出さない（`toolbar: false`か、全区画が空） */
  visible: boolean;
  /** 未指定は空文字列 */
  css: string;
  sections: Record<SidebarToolbarSection, ResolvedSidebarToolbarItem[]>;
}

/** 既定の並び。右端にコマンドパレットを開くボタンだけを置く */
export const DEFAULT_SIDEBAR_TOOLBAR: Required<Omit<SidebarToolbarConfig, "css">> = {
  left: [],
  right: ["builtin:command-palette"],
};

/** `builtin:<id>`がツールバー専用のビルトインならそのid。それ以外はnull */
export function parseSidebarToolbarBuiltin(value: string): SidebarToolbarBuiltin | null {
  if (!value.startsWith(BUILTIN_PREFIX)) return null;
  const id = value.slice(BUILTIN_PREFIX.length);
  return (SIDEBAR_TOOLBAR_BUILTINS as readonly string[]).includes(id)
    ? (id as SidebarToolbarBuiltin)
    : null;
}
