import { failAndExit } from "./cli-error";

/**
 * `--tab`省略時は`NIWATERM_TAB_ID`環境変数（niwaterm内で起動したシェルに自動設定される）を使う。
 * シェル統合スクリプト（precmdフック等）がタブ内から`--tab`無しで自タブを指せるようにするため。
 * どちらも無ければエラー終了する。
 */
export function resolveTabId(explicit: string | undefined): string {
  const tabId = explicit ?? process.env["NIWATERM_TAB_ID"];
  if (!tabId) {
    failAndExit(
      "tabIdが指定されていません。--tabで指定するか、niwaterm内のシェルから実行してください（NIWATERM_TAB_ID環境変数を自動参照します）",
    );
  }
  return tabId;
}
