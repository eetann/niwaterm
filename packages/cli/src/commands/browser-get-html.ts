import { define } from "gunshi";
import { browserGetHtml, ipcSocketPath } from "../ipc-client";

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
    const result = await browserGetHtml(ipcSocketPath(), ctx.values.tab);
    if (!result.ok) {
      console.error(`browser-get-htmlに失敗しました: ${result.error}`);
      process.exit(1);
    }
    console.log(result.html);
  },
});
