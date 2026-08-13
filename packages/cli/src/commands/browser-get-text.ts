import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { browserGetText, resolveIpcEndpoint } from "../ipc-client";

export default define({
  name: "browser-get-text",
  description: "指定したブラウザタブの表示内容をプレーンテキストで取得する",
  args: {
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtabId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await browserGetText(resolveIpcEndpoint(), ctx.values.tab);
    if (!result.ok) {
      failAndExit(`browser-get-textに失敗しました: ${result.error}`);
    }
    console.log(result.text);
  },
});
