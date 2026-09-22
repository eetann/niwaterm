import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, switchSidebarView } from "../../ipc-client";

export default define({
  name: "switch",
  description: "サイドバーに出すビューを切り替える",
  args: {
    view: {
      type: "string",
      short: "v",
      required: true,
      description:
        "表示するビューのid（customViewのid、またはワークスペース一覧のworkspaces。idはniwaterm config showで確認）",
    },
  },
  run: async (ctx) => {
    const result = await switchSidebarView(resolveIpcEndpoint(), ctx.values.view);
    if (!result.ok) {
      failAndExit(`sidebar switchに失敗しました: ${result.error}`);
    }
    console.log(`sidebar view: ${result.viewId}`);
  },
});
