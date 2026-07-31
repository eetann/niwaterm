import { define } from "gunshi";
import { ipcSocketPath, newTab } from "../ipc-client";

export default define({
  name: "new-tab",
  description: "指定したタイルに新規タブを作成する",
  args: {
    tile: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtileId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await newTab(ipcSocketPath(), ctx.values.tile);
    if (!result.ok) {
      console.error(`new-tabに失敗しました: ${result.error}`);
      process.exit(1);
    }
    console.log(`tab: ${result.tabId}`);
  },
});
