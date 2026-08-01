// ユーザー定義HTML UI（サイドバーの固定パネル・「名前付きビュー」としてのタブ表示）の設定。
// browser.tsと異なり、未設定なら機能自体がオフになる（表示すべきデフォルトHTMLが存在しないため
// defaultCustomViewConfigは用意しない。解決結果はnullableなResolvedCustomViewConfigで表現する）。

export interface CustomViewConfig {
  name?: string;
  /** niwaterm.config.tsのあるディレクトリからの相対 or 絶対パス。file://として読み込む */
  path?: string;
  /** path未指定時に使う任意URL */
  url?: string;
}

export interface ResolvedCustomViewConfig {
  name: string;
  /** pathが指定されていればfile://に解決済みのURL */
  url: string;
}
