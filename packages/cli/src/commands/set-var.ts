import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { ipcSocketPath, setTileVar } from "../ipc-client";
import { resolveTileId } from "../resolve-tile";

export default define({
  name: "set-var",
  description: "指定したタイルにkey-value変数を設定する（tmuxのペイン変数相当）",
  args: {
    tile: {
      type: "string",
      short: "t",
      description: "対象のtileId（niwaterm listで確認）。省略時はNIWATERM_TILE_ID環境変数を使う",
    },
    key: {
      type: "positional",
      description: "変数名（英数字・_・-・.のみ、1〜128文字）",
    },
    value: {
      type: "positional",
      description: "設定する値",
    },
  },
  run: async (ctx) => {
    const tileId = resolveTileId(ctx.values.tile);
    const result = await setTileVar(ipcSocketPath(), tileId, ctx.values.key, ctx.values.value);
    if (!result.ok) {
      failAndExit(`set-varに失敗しました: ${result.error}`);
    }
  },
});
