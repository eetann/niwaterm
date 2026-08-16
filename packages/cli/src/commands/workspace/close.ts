import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { closeWorkspace, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "close",
  description: "指定したワークスペースを閉じる（最後の1つは閉じられない）",
  args: {
    workspace: {
      type: "string",
      short: "w",
      required: true,
      description: "閉じるworkspaceId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await closeWorkspace(resolveIpcEndpoint(), ctx.values.workspace);
    if (!result.ok) {
      failAndExit(`workspace closeに失敗しました: ${result.error}`);
    }
  },
});
