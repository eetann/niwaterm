import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, revealHoverButton } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "hide",
  description: "tab hover revealで出したままにしたホバーボタンをしまう",
  args: {
    tab: {
      type: "string",
      short: "t",
      description:
        "対象のtabId（niwaterm listで確認）。省略時はこのコマンドを実行しているタブ（niwaterm外からならフォーカス中タイルのアクティブタブ）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "tab hover hide", { tabId: ctx.values.tab });
    const result = await revealHoverButton(endpoint, await target.tabId(), null);
    if (!result.ok) {
      failAndExit(`tab hover hideに失敗しました: ${result.error}`);
    }
  },
});
