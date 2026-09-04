import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, switchTab } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "switch",
  description: "指定したタイル内でアクティブタブを切り替える",
  args: {
    tile: {
      type: "string",
      description: "対象のtileId（niwaterm listで確認）。省略時は--tabのタブが属するタイル",
    },
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "切り替え先のtabId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "tab switch", {
      tileId: ctx.values.tile,
      tabId: ctx.values.tab,
    });
    const result = await switchTab(endpoint, await target.tileId(), ctx.values.tab);
    if (!result.ok) {
      failAndExit(`tab switchに失敗しました: ${result.error}`);
    }
  },
});
