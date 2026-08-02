import { define } from "gunshi";
import { browserGetText, ipcSocketPath } from "../ipc-client";

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
    const result = await browserGetText(ipcSocketPath(), ctx.values.tab);
    if (!result.ok) {
      console.error(`browser-get-textに失敗しました: ${result.error}`);
      process.exit(1);
    }
    console.log(result.text);
  },
});
