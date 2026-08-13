import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { focusTile, resolveIpcEndpoint } from "../ipc-client";

export default define({
  name: "focus-tile",
  description: "指定したタイルにフォーカスを移す",
  args: {
    tile: {
      type: "string",
      short: "t",
      required: true,
      description: "フォーカスするtileId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await focusTile(resolveIpcEndpoint(), ctx.values.tile);
    if (!result.ok) {
      failAndExit(`focus-tileに失敗しました: ${result.error}`);
    }
  },
});
