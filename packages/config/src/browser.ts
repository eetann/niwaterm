// ブラウザタブ設定。新規ブラウザタブ作成時のデフォルトURLをniwaterm.config.tsから変更できるようにする。
// appearance.tsと同様、全フィールドoptionalの型を「ユーザーの部分上書き」と「マージ後の解決済み値」の両方に使い回す。

export interface BrowserConfig {
  defaultUrl?: string;
}

export type ResolvedBrowserConfig = Required<BrowserConfig>;

export const defaultBrowserConfig: ResolvedBrowserConfig = {
  defaultUrl: "about:blank",
};
