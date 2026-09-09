// マウス操作の挙動設定。ドラッグ選択時の自動コピー・選択範囲の右クリックメニューを
// niwaterm.config.tsから変更できるようにする。
// appearance.tsと同様、全フィールドoptionalの型を「ユーザーの部分上書き」と「マージ後の解決済み値」の両方に使い回す。

import type { Niwa } from "./niwa";

/** selectionMenuの関数へ渡る、右クリックされた時点の選択範囲の情報 */
export interface SelectionMenuContext {
  /** 選択されているテキスト */
  text: string;
  /** 選択があるタブのid */
  tabId: string;
  /** そのタブが報告している作業ディレクトリ（OSC7シェル統合）。未報告ならundefined */
  cwd: string | undefined;
}

export interface SelectionMenuItem {
  /** メニューに並べるラベル */
  label: string;
  /** 項目を選んだ時の処理。niwa.shell.run等はここから呼ぶ */
  run: () => void | Promise<void>;
}

/**
 * 選択範囲の右クリックメニューを組み立てる関数。右クリックのたびに呼ばれるため、
 * 拡張子・OS（process.platform）・cwdによる出し分けは素のif文で書ける。
 * 空配列を返せばniwaterm組み込みの項目（コピー）だけのメニューになる。
 */
export type SelectionMenuFn = (
  selection: SelectionMenuContext,
  niwa: Niwa,
) => SelectionMenuItem[] | Promise<SelectionMenuItem[]>;

export interface MouseConfig {
  /** マウスでのテキスト選択が終わった時点で、選択範囲をクリップボードへ自動コピーする */
  copyOnSelect?: boolean;
  /** 選択範囲を右クリックした時に出すメニューの項目を組み立てる */
  selectionMenu?: SelectionMenuFn;
}

/**
 * マージ後の解決済み値。selectionMenuはbun側に留まる関数（RPCで渡せない）ため含めない。
 * webview側が受け取るのはこの型
 */
export type ResolvedMouseConfig = Required<Omit<MouseConfig, "selectionMenu">>;

export const defaultMouseConfig: ResolvedMouseConfig = {
  copyOnSelect: false,
};
