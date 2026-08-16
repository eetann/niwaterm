import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { browserNavigate, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "navigate",
  description: "指定したブラウザタブのURLを遷移する（Playwrightのpage.goto()相当）",
  args: {
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtabId（niwaterm listで確認）",
    },
    url: {
      type: "string",
      short: "u",
      required: true,
      description: "遷移先のURL",
    },
  },
  run: async (ctx) => {
    const result = await browserNavigate(resolveIpcEndpoint(), ctx.values.tab, ctx.values.url);
    if (!result.ok) {
      failAndExit(`browser navigateに失敗しました: ${result.error}`);
    }
  },
});
