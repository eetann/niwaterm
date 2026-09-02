import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { findTabsByVar, resolveIpcEndpoint } from "../../../ipc-client";

export default define({
  name: "find",
  description: "key=valueと一致する変数を持つタブをtabId一覧で表示する（1つのBoard内のみを検索）",
  args: {
    board: {
      type: "string",
      short: "b",
      description:
        "検索対象のboardId。省略時はNIWATERM_TAB_ID環境変数のタブが属するBoard、それも無ければアクティブなBoardを検索する",
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
    const result = await findTabsByVar(resolveIpcEndpoint(), ctx.values.key, ctx.values.value, {
      boardId: ctx.values.board,
      scopeTabId: process.env["NIWATERM_TAB_ID"],
    });
    if (!result.ok) {
      failAndExit(`tab var findに失敗しました: ${result.error}`);
    }
    for (const tabId of result.tabIds) console.log(tabId);
  },
});
