import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, showTab } from "../../ipc-client";

export default define({
  name: "show",
  description:
    "指定したタブのワークスペース・タイルへ切り替え、アクティブ化し、ウィンドウを前面化する（AIが普段ヘッドレスで操作しているタブを人間が任意に目視確認するためのコマンド）",
  args: {
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtabId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await showTab(resolveIpcEndpoint(), ctx.values.tab);
    if (!result.ok) {
      failAndExit(`tab showに失敗しました: ${result.error}`);
    }
  },
});
