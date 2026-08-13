import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { getTabVar, resolveIpcEndpoint } from "../ipc-client";
import { resolveTabId } from "../resolve-tab";

export default define({
  name: "get-var",
  description: "指定したタブの変数を取得する",
  args: {
    tab: {
      type: "string",
      short: "t",
      description: "対象のtabId（niwaterm listで確認）。省略時はNIWATERM_TAB_ID環境変数を使う",
    },
    key: {
      type: "positional",
      description: "取得する変数名",
    },
  },
  run: async (ctx) => {
    const tabId = resolveTabId(ctx.values.tab);
    const result = await getTabVar(resolveIpcEndpoint(), tabId, ctx.values.key);
    if (!result.ok) {
      failAndExit(`get-varに失敗しました: ${result.error}`);
    }
    console.log(result.value);
  },
});
