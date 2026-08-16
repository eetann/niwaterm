import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, switchTab } from "../../ipc-client";

export default define({
  name: "switch",
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
    const result = await switchTab(resolveIpcEndpoint(), ctx.values.tile, ctx.values.tab);
    if (!result.ok) {
      failAndExit(`tab switchに失敗しました: ${result.error}`);
    }
  },
});
