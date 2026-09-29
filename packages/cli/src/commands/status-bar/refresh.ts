import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { refreshStatusBar, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "refresh",
  description:
    "ステータスバーの部品を評価し直す（renderが読む外部の状態が変わったことを知らせる。全ウィンドウが対象）",
  args: {
    item: {
      type: "string",
      short: "i",
      description:
        "評価し直す部品のid（部品に付けたid。付けていなければleft-0のような区画-番号）。省略時は全部品",
    },
  },
  run: async (ctx) => {
    const result = await refreshStatusBar(resolveIpcEndpoint(), ctx.values.item);
    if (!result.ok) {
      failAndExit(`status-bar refreshに失敗しました: ${result.error}`);
    }
  },
});
