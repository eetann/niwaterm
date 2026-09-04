import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { captureTab, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "capture",
  description: "指定したタブの画面内容をテキストで取得する（tmux capture-pane相当）",
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
    const target = createTargetResolver(endpoint, "tab capture", { tabId: ctx.values.tab });
    const result = await captureTab(endpoint, await target.tabId());
    if (!result.ok) {
      failAndExit(`tab captureに失敗しました: ${result.error}`);
    }
    console.log(result.text);
  },
});
