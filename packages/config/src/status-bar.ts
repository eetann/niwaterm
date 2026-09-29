// ウィンドウ下端に1本出すステータスバーの設定。tmuxのstatus-left/status-right、Neovimのlualineと同じく
// 左・中央・右の3区画へ部品（コンポーネント）を並べる。表示の基準はそのウィンドウでフォーカス中のタブ。
//
// 部品の中身はビルトイン・タブ変数・ユーザー定義のrender関数の3通り。render・runはbun側でしか
// 呼べない関数なので、webviewへは部品のidと評価後の文字列だけを渡す（hoverButtonsと同じ方式）。
// builtin:modeだけはprefix待ち・コピーモードの状態をwebview側が持っているため、webview側で描く。

import type { Niwa } from "./niwa";
import { TAB_VAR_NAME_PATTERN } from "./sidebar";

/** 部品を並べる区画 */
export type StatusBarSection = "left" | "center" | "right";

export const STATUS_BAR_SECTIONS: readonly StatusBarSection[] = ["left", "center", "right"];

/**
 * ビルトインの部品。
 * - mode: キー入力のモード（NORMAL / PREFIX（prefixキー後の2打目待ち）/ COPY（コピーモード））
 * - cwd: フォーカス中タブの作業ディレクトリ（OSC7シェル統合）。ホームは`~`へ縮める
 * - workspace: ワークスペース名（未設定なら連番）
 * - board: Board名（未設定なら自動名・連番）
 */
export type StatusBarBuiltin = "mode" | "cwd" | "workspace" | "board";

const STATUS_BAR_BUILTINS: readonly StatusBarBuiltin[] = ["mode", "cwd", "workspace", "board"];

const BUILTIN_PREFIX = "builtin:";
const TAB_VAR_PREFIX = "tab-var:";

/** 1部品の値の出どころ。`builtin:<id>`か`tab-var:<name>`をパースした結果 */
export type StatusBarSource =
  | { kind: "builtin"; id: StatusBarBuiltin }
  | { kind: "tab-var"; name: string };

/** render・runへ渡るウィンドウの状況。フォーカス中のタブが無い（Boardが無い）ときはタブ系がnull */
export interface StatusBarContext {
  windowId: string;
  workspaceId: string;
  /** ワークスペースの表示名（サイドバーと同じ。未設定なら"Workspace <n>"） */
  workspaceName: string;
  boardId: string | null;
  /** Boardの表示名（サイドバーと同じ。未設定なら自動名・"Board <n>"） */
  boardName: string | null;
  /** フォーカス中タイルのアクティブタブ */
  tabId: string | null;
  /** フォーカス中タブが報告している作業ディレクトリ（OSC7シェル統合）。未報告ならundefined */
  cwd: string | undefined;
  /** フォーカス中タブのタブ変数（`niwaterm tab var set`・シェル統合が書き込む） */
  vars: Record<string, string>;
  /** ユーザーがサイドバーから設定したタブ名。未設定はundefined */
  tabName: string | undefined;
}

/** render関数が返す1部品ぶんの表示 */
export interface StatusBarSegment {
  /** 表示するテキスト。htmlを併記した場合はhtmlが優先される */
  text?: string;
  /**
   * textの代わりに差し込むHTML。niwaterm本体のwebview内へそのまま入るため、
   * 外部から来た文字列（コマンド出力等）を埋め込むときはユーザー側でエスケープすること
   */
  html?: string;
  /** マウスを載せた時に出す説明 */
  tooltip?: string;
  /** 文字色（CSSカラー） */
  color?: string;
}

/**
 * 部品の中身を組み立てる関数。文字列を返せばtextだけを指定したのと同じ。
 * null・undefined・空文字列を返すとその部品は出ない（区切りも詰める）。
 * フォーカス中タブ・タブ変数・Board・ワークスペースが変わった時と、intervalを指定した場合は
 * その周期で呼ばれる
 */
export type StatusBarRenderFn = (
  ctx: StatusBarContext,
  niwa: Niwa,
) =>
  | StatusBarSegment
  | string
  | null
  | undefined
  | Promise<StatusBarSegment | string | null | undefined>;

export interface StatusBarComponentConfig {
  /**
   * `niwaterm status-bar refresh --item <id>`で指す名前。英数字・`_`・`-`で、部品間で重ねない。
   * 省略時は`left-0`のような「区画-区画内の番号」になる（並べ替えると変わる）
   */
  id?: string;
  /**
   * `builtin:mode` / `builtin:cwd` / `builtin:workspace` / `builtin:board` / `tab-var:<name>`。
   * renderと同時には書けない（renderが優先される）
   */
  source?: string;
  /** 中身を組み立てる関数。sourceの代わりに書く */
  render?: StatusBarRenderFn;
  /**
   * renderを呼び直す周期(ms)。時計のように状況の変化と関係なく変わる値に使う。
   * 省略時は状況が変わった時だけ呼ぶ。STATUS_BAR_MIN_INTERVAL_MS未満は切り上げる
   */
  interval?: number;
  /** 値の前に出す短いラベル。builtin:modeでは使わない */
  prefix?: string;
  /** 文字色（CSSカラー）。builtin:modeでは使わない（モードごとの配色はappearance.uiから取る） */
  color?: string;
  /** マウスを載せた時に出す説明。renderが返したtooltipがあればそちらが優先される */
  tooltip?: string;
  /** 部品を押した時の処理。書いた部品だけが押せる見た目になる */
  run?: (ctx: StatusBarContext, niwa: Niwa) => unknown;
}

/** 文字列だけで書いた場合はsourceだけを指定したのと同じ */
export type StatusBarComponent = string | StatusBarComponentConfig;

export interface StatusBarConfig {
  /** 左端から並べる部品。省略時はDEFAULT_STATUS_BAR.left */
  left?: StatusBarComponent[];
  /** 中央に並べる部品。省略時はDEFAULT_STATUS_BAR.center */
  center?: StatusBarComponent[];
  /** 右端へ寄せて並べる部品。省略時はDEFAULT_STATUS_BAR.right */
  right?: StatusBarComponent[];
  /**
   * 部品のhtmlから参照するCSS。webviewの<style>へそのまま入るので、
   * niwaterm本体のスタイルと衝突しないようclass名を工夫すること
   */
  css?: string;
}

/** webviewへ渡す部品1件。関数を除き、描き方の判断に要るものだけを持つ */
export interface ResolvedStatusBarItem {
  id: string;
  /** "mode"はwebview側で描く。"value"はbun側で評価した値（statusBarValues）を出す */
  kind: "mode" | "value";
  /** runを持つか。押せる見た目にするかどうかに使う */
  clickable: boolean;
}

export interface ResolvedStatusBarConfig {
  /** falseならステータスバーを出さない（`statusBar: false`か、全区画が空） */
  visible: boolean;
  /** 未指定は空文字列 */
  css: string;
  sections: Record<StatusBarSection, ResolvedStatusBarItem[]>;
}

/** bun側で評価し終えた部品1件の表示。text・htmlとも空なら出さない */
export interface StatusBarValue {
  text: string;
  html: string;
  tooltip: string;
  /** 未指定は空文字列（表示側の既定色） */
  color: string;
}

/**
 * 既定の並び。サイドバーに出ている情報（Board名・ブランチ・エージェント状態）とは重ねず、
 * サイドバーからは分からないキー入力のモードと、今どのディレクトリにいるかだけを出す
 */
export const DEFAULT_STATUS_BAR: Required<Omit<StatusBarConfig, "css">> = {
  left: ["builtin:mode"],
  center: [],
  right: ["builtin:cwd"],
};

/** intervalの下限(ms)。短すぎる周期でrenderを呼ぶとbun側のイベントループを圧迫する */
export const STATUS_BAR_MIN_INTERVAL_MS = 250;

/** `builtin:<id>`・`tab-var:<name>`を解釈する。未知の接頭辞・不正な名前はnull */
export function parseStatusBarSource(value: string): StatusBarSource | null {
  if (value.startsWith(BUILTIN_PREFIX)) {
    const id = value.slice(BUILTIN_PREFIX.length);
    return (STATUS_BAR_BUILTINS as readonly string[]).includes(id)
      ? { kind: "builtin", id: id as StatusBarBuiltin }
      : null;
  }
  if (value.startsWith(TAB_VAR_PREFIX)) {
    const name = value.slice(TAB_VAR_PREFIX.length);
    return TAB_VAR_NAME_PATTERN.test(name) ? { kind: "tab-var", name } : null;
  }
  return null;
}
