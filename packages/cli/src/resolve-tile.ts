import { failAndExit } from "./cli-error";

/**
 * `--tile`省略時は`NIWATERM_TILE_ID`環境変数（niwaterm内で起動したシェルに自動設定される）を使う。
 * シェル統合スクリプト（precmdフック等）がタイル内から`--tile`無しで自タイルを指せるようにするため。
 * どちらも無ければエラー終了する。
 */
export function resolveTileId(explicit: string | undefined): string {
  const tileId = explicit ?? process.env["NIWATERM_TILE_ID"];
  if (!tileId) {
    failAndExit(
      "tileIdが指定されていません。--tileで指定するか、niwaterm内のシェルから実行してください（NIWATERM_TILE_ID環境変数を自動参照します）",
    );
  }
  return tileId;
}
