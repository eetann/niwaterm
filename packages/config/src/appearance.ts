// 外観設定。フォント・カラーテーマをniwaterm.config.tsから変更できるようにする。
// 全フィールドoptionalの型を「ユーザーの部分上書き」と「マージ後の解決済み値」の両方に使い回す。

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
};
