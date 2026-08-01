import { define } from "gunshi";
import { ipcSocketPath, listTileVars } from "../ipc-client";

export default define({
  name: "list-vars",
  description: "指定したタイルの変数を一覧表示する",
  args: {
    tile: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtileId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await listTileVars(ipcSocketPath(), ctx.values.tile);
    if (!result.ok) {
      console.error(`list-varsに失敗しました: ${result.error}`);
      process.exit(1);
    }
    const entries = Object.entries(result.vars).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
      console.log("(no variables)");
      return;
    }
    for (const [key, value] of entries) console.log(`${key}=${value}`);
  },
});
