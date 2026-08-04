import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { getTileVar, ipcSocketPath } from "../ipc-client";

export default define({
  name: "get-var",
  description: "指定したタイルの変数を取得する",
  args: {
    tile: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtileId（niwaterm listで確認）",
    },
    key: {
      type: "positional",
      description: "取得する変数名",
    },
  },
  run: async (ctx) => {
    const result = await getTileVar(ipcSocketPath(), ctx.values.tile, ctx.values.key);
    if (!result.ok) {
      failAndExit(`get-varに失敗しました: ${result.error}`);
    }
    console.log(result.value);
  },
});
