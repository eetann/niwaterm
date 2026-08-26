import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { findTabsByVar, resolveIpcEndpoint } from "../../../ipc-client";
import { resolveTabId } from "../../../resolve-tab";

export default define({
  name: "find",
  description:
    "key=valueと一致する変数を持つタブをtabId一覧で表示する（--tabで指定した起点タブと同じワークスペース内のみを検索）",
  args: {
    tab: {
      type: "string",
      short: "t",
      description:
        "起点タブのtabId。省略時はNIWATERM_TAB_ID環境変数を使う。このタブと同じワークスペース内から検索する",
    },
    key: {
      type: "positional",
      description: "検索する変数名",
    },
    value: {
      type: "positional",
      description: "検索する値",
    },
  },
  run: async (ctx) => {
    const scopeTabId = resolveTabId(ctx.values.tab);
    const result = await findTabsByVar(
      resolveIpcEndpoint(),
      ctx.values.key,
      ctx.values.value,
      scopeTabId,
    );
    if (!result.ok) {
      failAndExit(`tab var findに失敗しました: ${result.error}`);
    }
    for (const tabId of result.tabIds) console.log(tabId);
  },
});
