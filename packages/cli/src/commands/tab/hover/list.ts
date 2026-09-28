import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { listHoverButtons, resolveIpcEndpoint } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "list",
  description: "指定したタブで今出せるホバーボタンと、その項目を一覧表示する",
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
    const target = createTargetResolver(endpoint, "tab hover list", { tabId: ctx.values.tab });
    const result = await listHoverButtons(endpoint, await target.tabId());
    if (!result.ok) {
      failAndExit(`tab hover listに失敗しました: ${result.error}`);
    }
    if (result.buttons.length === 0) {
      console.log("(no hover buttons)");
      return;
    }
    for (const button of result.buttons) {
      console.log(`${button.position}\t${button.id}`);
      for (const item of button.items) {
        // htmlだけの項目はラベルが無いので、目印としてidを出す
        console.log(`  ${item.label || item.tooltip || `(html: ${item.id})`}`);
      }
    }
  },
});
