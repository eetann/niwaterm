import { define } from "gunshi";
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
      console.error(`get-varに失敗しました: ${result.error}`);
      process.exit(1);
    }
    console.log(result.value);
  },
});
