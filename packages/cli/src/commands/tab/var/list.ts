import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, listTabVars } from "../../../ipc-client";
import { resolveTabId } from "../../../resolve-tab";

export default define({
  name: "list",
  description: "指定したタブの変数を一覧表示する",
  args: {
    tab: {
      type: "string",
      short: "t",
      description: "対象のtabId（niwaterm listで確認）。省略時はNIWATERM_TAB_ID環境変数を使う",
    },
  },
  run: async (ctx) => {
    const tabId = resolveTabId(ctx.values.tab);
    const result = await listTabVars(resolveIpcEndpoint(), tabId);
    if (!result.ok) {
      failAndExit(`tab var listに失敗しました: ${result.error}`);
    }
    const entries = Object.entries(result.vars).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
      console.log("(no variables)");
      return;
    }
    for (const [key, value] of entries) console.log(`${key}=${value}`);
  },
});
