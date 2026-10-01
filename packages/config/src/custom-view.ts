// ユーザー定義HTML UI（サイドバーのパネル・「名前付きビュー」としてのタブ表示）の設定。
// browser.tsと異なり、未設定なら機能自体がオフになる（表示すべきデフォルトHTMLが存在しないため
// defaultCustomViewConfigは用意しない。解決結果は空配列で「1つも無い」を表す）。

import type { Niwa } from "./niwa";

/**
 * HTML側の`niwaterm.call(name, payload)`から呼ばれる関数。payloadはHTML側が渡した値、
 * 戻り値はHTML側のawaitへ返る値で、どちらもJSONへ変換できる形でなければならない
 * （HTMLはwebview、ハンドラはniwaterm本体と別プロセスで動くため）。
 * niwa.shell.run等の操作は第2引数から呼ぶ（mouse.selectionMenuのrunと同じ渡し方）。
 * payloadがanyなのは、ハンドラごとに異なる引数の型をユーザー自身が書けるようにするため。
 */
export type CustomViewHandler = (payload: any, niwa: Niwa) => unknown;

/** キーが`niwaterm.call`へ渡す名前になる */
export type CustomViewHandlers = Record<string, CustomViewHandler>;

/** ワークスペース一覧ビューのid。customView側がこのidを名乗ることはできない */
export const WORKSPACES_VIEW_ID = "workspaces";

export interface CustomViewConfig {
  /**
   * キーバインド（`show-sidebar-view:<id>`）・CLI（`niwa sidebar switch --view <id>`）から
   * このビューを指すためのid。省略時はnameから導出する（resolveCustomViews参照）
   */
  id?: string;
  name?: string;
  /** niwaterm.config.tsのあるディレクトリからの相対 or 絶対パス。file://として読み込む */
  path?: string;
  /** path未指定時に使う任意URL */
  url?: string;
  /** HTML側から`niwaterm.call(name, payload)`で呼べる関数群 */
  handlers?: CustomViewHandlers;
}

export interface ResolvedCustomViewConfig {
  /** 解決済みのid。全customViewで一意で、WORKSPACES_VIEW_IDとも衝突しない */
  id: string;
  name: string;
  /** pathが指定されていればfile://に解決済みのURL */
  url: string;
  /**
   * 呼び出せるハンドラ名。関数の実体はRPCで渡せずbun側に残るため、webviewへは名前だけを渡す
   * （mouse.selectionMenuのSelectionMenuEntryと同じ方式）
   */
  handlerNames: string[];
}
