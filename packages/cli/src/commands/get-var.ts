import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { getTileVar, ipcSocketPath } from "../ipc-client";
import { resolveTileId } from "../resolve-tile";

export default define({
  name: "get-var",
  description: "指定したタイルの変数を取得する",
  args: {
    tile: {
      type: "string",
      short: "t",
      description: "対象のtileId（niwaterm listで確認）。省略時はNIWATERM_TILE_ID環境変数を使う",
    },
    key: {
      type: "positional",
      description: "取得する変数名",
    },
  },
  run: async (ctx) => {
    const tileId = resolveTileId(ctx.values.tile);
    const result = await getTileVar(ipcSocketPath(), tileId, ctx.values.key);
    if (!result.ok) {
      failAndExit(`get-varに失敗しました: ${result.error}`);
    }
    console.log(result.value);
  },
});
