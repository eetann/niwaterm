import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, showTab } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "focus",
  description:
    "指定したタブのワークスペース・タイルへ切り替え、アクティブ化し、ウィンドウを前面化する（AIが普段ヘッドレスで操作しているタブを人間が任意に目視確認するためのコマンド）",
  args: {
    tab: {
      type: "string",
      short: "t",
      description:
        "対象のtabId（niwaterm listで確認）。省略時はこのコマンドを実行しているタブ（niwatermの外から実行した場合はフォーカス中タイルのアクティブタブ）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "tab focus", { tabId: ctx.values.tab });
    const result = await showTab(endpoint, await target.tabId());
    if (!result.ok) {
      failAndExit(`tab focusに失敗しました: ${result.error}`);
    }
  },
});
