// ターミナル本体の挙動設定。スクロールバックの保持行数をniwaterm.config.tsから変更できるようにする。
// browser.tsと同様、全フィールドoptionalの型を「ユーザーの部分上書き」と「マージ後の解決済み値」の
// 両方に使い回す。

export interface TerminalConfig {
  /**
   * スクロールバックとして保持する行数の上限。
   * libghostty側の実装はページ単位でしか刈り込まないため、実際に遡れる行数は指定値より
   * 数十〜数百行多くなる（上限は目安として扱う）。0を指定しても1ページ分は残る。
   */
  scrollback?: number;
}

export type ResolvedTerminalConfig = Required<TerminalConfig>;

export const defaultTerminalConfig: ResolvedTerminalConfig = {
  scrollback: 10_000,
};
