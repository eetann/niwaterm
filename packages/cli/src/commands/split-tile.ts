import { define } from "gunshi";
import { ipcSocketPath, splitTile } from "../ipc-client";

export default define({
  name: "split-tile",
  description: "指定したタイルを分割する",
  args: {
    tile: {
      type: "string",
      short: "t",
      required: true,
      description: "分割対象のtileId（niwaterm listで確認）",
    },
    orientation: {
      type: "enum",
      choices: ["horizontal", "vertical"] as const,
      default: "vertical",
      description: "分割方向（デフォルト: vertical）",
    },
  },
  run: async (ctx) => {
    const result = await splitTile(ipcSocketPath(), ctx.values.tile, ctx.values.orientation);
    if (!result.ok) {
      console.error(`split-tileに失敗しました: ${result.error}`);
      process.exit(1);
    }
    console.log(`tile: ${result.tileId}, tab: ${result.tabId}`);
  },
});
