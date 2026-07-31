import { define } from "gunshi";
import { closeTab, ipcSocketPath } from "../ipc-client";

export default define({
  name: "close-tab",
  description: "指定したタブを閉じる（tmux kill-window相当）",
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
      description: "閉じるtabId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await closeTab(ipcSocketPath(), ctx.values.tile, ctx.values.tab);
    if (!result.ok) {
      console.error(`close-tabに失敗しました: ${result.error}`);
      process.exit(1);
    }
  },
});
