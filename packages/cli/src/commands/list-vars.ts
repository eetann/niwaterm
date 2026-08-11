import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { ipcSocketPath, listTileVars } from "../ipc-client";
import { resolveTileId } from "../resolve-tile";

export default define({
  name: "list-vars",
  description: "指定したタイルの変数を一覧表示する",
  args: {
    tile: {
      type: "string",
      short: "t",
      description: "対象のtileId（niwaterm listで確認）。省略時はNIWATERM_TILE_ID環境変数を使う",
    },
  },
  run: async (ctx) => {
    const tileId = resolveTileId(ctx.values.tile);
    const result = await listTileVars(ipcSocketPath(), tileId);
    if (!result.ok) {
      failAndExit(`list-varsに失敗しました: ${result.error}`);
    }
    const entries = Object.entries(result.vars).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
      console.log("(no variables)");
      return;
    }
    for (const [key, value] of entries) console.log(`${key}=${value}`);
  },
});
