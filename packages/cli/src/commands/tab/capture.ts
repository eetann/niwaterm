import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { captureTab, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "capture",
  description: "指定したタブの画面内容をテキストで取得する（tmux capture-pane相当）",
  args: {
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtabId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await captureTab(resolveIpcEndpoint(), ctx.values.tab);
    if (!result.ok) {
      failAndExit(`tab captureに失敗しました: ${result.error}`);
    }
    console.log(result.text);
  },
});
