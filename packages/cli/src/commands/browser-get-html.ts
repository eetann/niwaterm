import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { browserGetHtml, resolveIpcEndpoint } from "../ipc-client";

export default define({
  name: "browser-get-html",
  description: "指定したブラウザタブのHTMLを取得する",
  args: {
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtabId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await browserGetHtml(resolveIpcEndpoint(), ctx.values.tab);
    if (!result.ok) {
      failAndExit(`browser-get-htmlに失敗しました: ${result.error}`);
    }
    console.log(result.html);
  },
});
