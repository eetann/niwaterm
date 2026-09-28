// タブの表示領域の端に置くボタンの設定。
// custom-view.tsと同様、未設定なら機能自体がオフになる（既定のボタンは無いのでdefault定数は持たない）。
// 1エントリ＝1つの位置に置く「枠」で、取っ手を押したとき（handle: falseならマウスを端へ寄せたとき）に
// itemsが返した項目が並ぶ。
// 項目1つならただのボタン、複数なら目次のように並ぶ（どちらも同じ形で書けるようitemsは常に配列）。

import type { Niwa } from "./niwa";

/**
 * ホバーボタンを置ける位置。基準はタブの表示領域（タイル内）で、ウィンドウ全体ではない。
 * 上下の辺は左端・中央・右端の3箇所、左右の辺は中央のみの計8方向
 */
export type HoverButtonPosition =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

export const HOVER_BUTTON_POSITIONS: readonly HoverButtonPosition[] = [
  "top-left",
  "top",
  "top-right",
  "left",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

export function isHoverButtonPosition(value: unknown): value is HoverButtonPosition {
  return typeof value === "string" && (HOVER_BUTTON_POSITIONS as readonly string[]).includes(value);
}

/** show・itemsへ渡るタブの状況。mouse.selectionMenuのSelectionMenuContextと同じ役回り */
export interface HoverButtonContext {
  tabId: string;
  /** そのタブが報告している作業ディレクトリ（OSC7シェル統合）。未報告ならundefined */
  cwd: string | undefined;
  /**
   * そのタブのタブ変数（`niwaterm tab var set`・シェル統合・エージェント統合のhookが書き込む）。
   * cwdもこの中の"cwd"に入っている
   */
  vars: Record<string, string>;
  /** ユーザーがサイドバーから設定したタブ名。未設定はundefined */
  tabName: string | undefined;
}

export interface HoverButtonItem {
  /**
   * 表示するテキスト。htmlを併記した場合は表示に使われず、`niwaterm tab hover list`・
   * ツールチップの既定値としてだけ使われる
   */
  label?: string;
  /**
   * labelの代わりに項目の中身として差し込むHTML。niwaterm本体のwebview内へそのまま入るため、
   * 外部から来た文字列（コマンド出力等）を埋め込むときはユーザー側でエスケープすること。
   * クリックの拾い方・並べ方はniwaterm側が持つので、ここではa要素・button要素にしなくてよい
   */
  html?: string;
  /** マウスを載せた時に出す説明。省略時はlabelが使われる */
  tooltip?: string;
  /** 項目を押した時の処理。niwa.popup.open等はここから呼ぶ */
  run: () => void | Promise<void>;
}

/**
 * 枠を開いたときに並べる項目を組み立てる関数。開くたびに呼ばれるため、
 * ファイルの読み直し・コマンド実行を伴う動的な項目でも素のTSで書ける。
 * 空配列を返せば何も出ない（取っ手・呼び出しの帯だけが残る）
 */
export type HoverButtonItemsFn = (
  ctx: HoverButtonContext,
  niwa: Niwa,
) => HoverButtonItem[] | Promise<HoverButtonItem[]>;

/**
 * 取っ手の置き方。"edge"は端に貼り付く形（辺なら半分、角なら1/4に切った形になる）、
 * "floating"は端から少し離れて浮く小さなアイコンボタン
 */
export type HoverButtonHandleStyle = "edge" | "floating";

export const HOVER_BUTTON_HANDLE_STYLES: readonly HoverButtonHandleStyle[] = ["edge", "floating"];

/**
 * "edge"の取っ手の形。辺に置くと半円・細長い長方形・三角（ひし形の半分）、
 * 角に置くと1/4円・正方形・直角三角形（ひし形の1/4）になる
 */
export type HoverButtonHandleShape = "round" | "rect" | "diamond";

export const HOVER_BUTTON_HANDLE_SHAPES: readonly HoverButtonHandleShape[] = [
  "round",
  "rect",
  "diamond",
];

export interface HoverButtonHandleConfig {
  /** 省略時は"edge" */
  style?: HoverButtonHandleStyle;
  /** "edge"のときの形。省略時はDEFAULT_HOVER_HANDLE_SHAPE */
  shape?: HoverButtonHandleShape;
  /**
   * "floating"のときにボタンの中へ差し込むHTML。省略時はDEFAULT_HOVER_HANDLE_ICON。
   * itemsのhtmlと同じくwebviewへそのまま入る
   */
  icon?: string;
}

export interface HoverButtonConfig {
  /**
   * CLI（`niwaterm tab hover reveal --button <id>`）からこのボタンを指すためのid。
   * 省略時はpositionと出現順から導出する（resolveHoverButtons参照）
   */
  id?: string;
  /** 置く位置。省略時はDEFAULT_HOVER_BUTTON_POSITION */
  position?: HoverButtonPosition;
  /**
   * このタブに取っ手（呼び出しの帯）を出すか。省略時は全てのターミナルタブへ出す。
   * タブ変数・cwdが変わるたびに評価されるため、非同期処理を伴わない軽い判定だけを書くこと
   */
  show?: (ctx: HoverButtonContext) => boolean;
  /** 枠を開いた時に並べる項目 */
  items: HoverButtonItemsFn;
  /**
   * itemsのhtmlから参照するCSS。webviewの<style>へそのまま入るので、
   * niwaterm本体やほかのボタンのスタイルと衝突しないようclass名にidを含める等で避けること
   */
  css?: string;
  /**
   * 常に出しておく取っ手。押すと枠が開き、もう一度押す・枠の外を押す・Escで閉じる。
   * falseなら取っ手を出さず、端の見えない帯へマウスを寄せた間だけ枠を出す。
   * 省略時は{ style: "edge", shape: DEFAULT_HOVER_HANDLE_SHAPE }
   */
  handle?: HoverButtonHandleConfig | false;
  /**
   * handle: falseのときの呼び出しの帯の太さ(px)。この幅まで端へ寄ればこの枠が出る。
   * 省略時はDEFAULT_HOVER_TRIGGER_PX。2〜200の範囲へ丸める
   */
  trigger?: number;
}

export interface ResolvedHoverButtonHandle {
  style: HoverButtonHandleStyle;
  shape: HoverButtonHandleShape;
  icon: string;
}

/**
 * マージ後の解決済み値。show・itemsはbun側に留まる関数（RPCで渡せない）ため含めない。
 * webview側が受け取るのはこの型で、どのタブに帯を張るかは別途タブごとに配られる
 */
export interface ResolvedHoverButtonConfig {
  id: string;
  position: HoverButtonPosition;
  /** 未指定は空文字列（webview側が<style>を作らない合図） */
  css: string;
  /** 取っ手。nullなら取っ手を出さず、ホバーの帯で開く */
  handle: ResolvedHoverButtonHandle | null;
  /** 呼び出しの帯の太さ(px)。handleがnullのときだけwebview側の当たり判定がこの値を使う */
  trigger: number;
}

/**
 * positionを省略したときの位置。右下はプロンプトの入力位置・左上の出力の読み始めから遠く、
 * 取っ手が常に出ていても文字を隠しにくい
 */
export const DEFAULT_HOVER_BUTTON_POSITION: HoverButtonPosition = "bottom-right";

/** "edge"の取っ手のshapeを省略したときの形。角に置くと1/4のひし形で、最も場所を取らない */
export const DEFAULT_HOVER_HANDLE_SHAPE: HoverButtonHandleShape = "diamond";

/** "floating"の取っ手にiconを指定しなかったときの中身 */
export const DEFAULT_HOVER_HANDLE_ICON = "☰";

/**
 * 呼び出しの帯の太さ(px)の既定値。マウスを端へ突き当てて止められない辺
 * （タイル境界）でも狙えるだけの幅を取る。帯はDOM要素ではないため、
 * 出ていない間のクリック・選択・マウスレポートは奪わない
 */
export const DEFAULT_HOVER_TRIGGER_PX = 24;

/** 帯の太さとして受け付ける範囲。広すぎる帯は画面の大半で枠が出てしまう */
export const HOVER_TRIGGER_MIN_PX = 2;
export const HOVER_TRIGGER_MAX_PX = 200;
