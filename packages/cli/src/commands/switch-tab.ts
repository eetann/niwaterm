import { define } from "gunshi";
import { ipcSocketPath, switchTab } from "../ipc-client";

export default define({
  name: "switch-tab",
  description: "指定したタイル内でアクティブタブを切り替える",
  args: {
    tile: {
      type: "string",
      required: true,
      description: "対象のtileId（niwaterm listで確認）",
    },
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "切り替え先のtabId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await switchTab(ipcSocketPath(), ctx.values.tile, ctx.values.tab);
    if (!result.ok) {
      console.error(`switch-tabに失敗しました: ${result.error}`);
      process.exit(1);
    }
  },
});
