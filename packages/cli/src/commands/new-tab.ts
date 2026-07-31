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
    url: {
      type: "string",
      short: "u",
      description:
        "指定すると、そのURLを開くブラウザタブを作成する（省略時は通常のターミナルタブ）",
    },
  },
  run: async (ctx) => {
    const result = await newTab(ipcSocketPath(), ctx.values.tile, ctx.values.url);
    if (!result.ok) {
      console.error(`new-tabに失敗しました: ${result.error}`);
      process.exit(1);
    }
    console.log(`tab: ${result.tabId}`);
  },
});
