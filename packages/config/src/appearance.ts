// 外観設定。フォント・カラーテーマをniwaterm.config.tsから変更できるようにする。
// 全フィールドoptionalの型を「ユーザーの部分上書き」と「マージ後の解決済み値」の両方に使い回す。

/**
 * タブが1つだけのタイルでのタブバーの出し方。
 * "auto": 高さを占有させず、タイル上端へマウスを寄せた間だけターミナルへ重ねて出す。
 * "always": タブの数に関わらず常に高さを占有して出す
 */
export type TabBarMode = "auto" | "always";

export function isTabBarMode(value: unknown): value is TabBarMode {
  return value === "auto" || value === "always";
}

/**
 * ネイティブのタイトルバーの出し方。
 * "default": OS標準のタイトルバー（ウィンドウ操作ボタン付き）を出す。
 * "hidden": タイトルバーを隠してその高さぶんを画面へ回す。ウィンドウの移動は
 * サイドバーのツールバーをドラッグして行う
 */
export type TitleBarMode = "default" | "hidden";

export function isTitleBarMode(value: unknown): value is TitleBarMode {
  return value === "default" || value === "hidden";
}

export interface AppearanceConfig {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  foreground?: string;
  background?: string;
  /**
   * 背景の不透明度（0〜1）。1未満にするとウィンドウ自体が透過し、背後のウィンドウが透ける。
   * 透過中はサブピクセルアンチエイリアスが使えずグレースケール描画に落ちるため、
   * 文字の見え方が変わる
   */
  backgroundOpacity?: number;
  /**
   * 背景画像。CSSのbackground-image値（`linear-gradient(...)` / `url(...)` / `none`）か、
   * 画像ファイルのパスを指定する。パスの場合はdata URIへ変換して埋め込む
   */
  backgroundImage?: string;
  // index 0-15がANSI標準色（0-7:通常, 8-15:bright）。不足分・不正値はdefaultAppearanceにフォールバック
  ansiColors?: readonly string[];
  /**
   * タブが1つだけのタイルでタブバーに1行分の高さを常時割くかどうか。
   * ブラウザタブだけのタイルは"auto"でも常時表示のまま（ネイティブのwebviewはHTMLより手前に
   * 描かれるため重ねられない。docs/known-issues/electrobun-hidden-webview-still-eats-mouse-events.md）
   */
  tabBar?: TabBarMode;
  /**
   * ネイティブのタイトルバーを隠すかどうか。背景の透過（backgroundOpacity）とは独立していて、
   * 片方だけでも組み合わせても使える。
   * 隠すとウィンドウ操作ボタンも消えるため、移動はサイドバーのツールバーのドラッグ、
   * 最小化・最大化・終了はキーバインドやOSのショートカットが窓口になる
   */
  titleBar?: TitleBarMode;
}

export type ResolvedAppearanceConfig = Required<AppearanceConfig>;

export const defaultAppearance: ResolvedAppearanceConfig = {
  fontFamily:
    '"HackGen Console NF", "SF Mono", Menlo, Monaco, "Hiragino Kaku Gothic ProN", "Hiragino Sans", monospace',
  fontSize: 13,
  lineHeight: 18,
  foreground: "#cdd6f4",
  background: "#1e1e2e",
  backgroundOpacity: 1,
  backgroundImage: "none",
  ansiColors: [
    "#45475a",
    "#f38ba8",
    "#a6e3a1",
    "#f9e2af",
    "#89b4fa",
    "#f5c2e7",
    "#94e2d5",
    "#bac2de",
    "#585b70",
    "#f38ba8",
    "#a6e3a1",
    "#f9e2af",
    "#89b4fa",
    "#f5c2e7",
    "#94e2d5",
    "#a6adc8",
  ],
  tabBar: "auto",
  titleBar: "default",
};

/**
 * フォントサイズを変えたときの行の高さ。設定に書かれた行間の比率（lineHeight / fontSize）を保つ。
 *
 * 行の高さを据え置いたままフォントだけ拡大すると、グリフが行ボックスへ収まらず上下の行へ
 * 食い込む。セル矩形いっぱいに描かれる文字（█ ░ 等）は行の高さを前提に補正しているため、
 * とくに崩れが目立つ。
 */
export function scaleLineHeight(
  base: Pick<ResolvedAppearanceConfig, "fontSize" | "lineHeight">,
  fontSize: number,
): number {
  if (!(base.fontSize > 0)) return base.lineHeight;
  return Math.round((base.lineHeight / base.fontSize) * fontSize);
}
