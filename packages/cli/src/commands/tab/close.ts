import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { closeTab, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "close",
  description: "指定したタブを閉じる（tmux kill-window相当）",
  args: {
    tile: {
      type: "string",
      description: "対象のtileId（niwaterm listで確認）。省略時は--tabのタブが属するタイル",
    },
    tab: {
      type: "string",
      short: "t",
      description:
        "閉じるtabId（niwaterm listで確認）。省略時はこのコマンドを実行しているタブ（niwatermの外から実行した場合はフォーカス中タイルのアクティブタブ）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "tab close", {
      tileId: ctx.values.tile,
      tabId: ctx.values.tab,
    });
    const result = await closeTab(endpoint, await target.tileId(), await target.tabId());
    if (!result.ok) {
      failAndExit(`tab closeに失敗しました: ${result.error}`);
    }
  },
});
