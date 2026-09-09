// マウス操作の挙動設定。ドラッグ選択時の自動コピーをniwaterm.config.tsから変更できるようにする。
// appearance.tsと同様、全フィールドoptionalの型を「ユーザーの部分上書き」と「マージ後の解決済み値」の両方に使い回す。

export interface MouseConfig {
  /** マウスでのテキスト選択が終わった時点で、選択範囲をクリップボードへ自動コピーする */
  copyOnSelect?: boolean;
}

export type ResolvedMouseConfig = Required<MouseConfig>;

export const defaultMouseConfig: ResolvedMouseConfig = {
  copyOnSelect: false,
};
