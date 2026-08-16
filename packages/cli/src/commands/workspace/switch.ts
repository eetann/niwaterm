import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, switchWorkspace } from "../../ipc-client";

export default define({
  name: "switch",
  description: "指定したワークスペースへ切り替える",
  args: {
    workspace: {
      type: "string",
      short: "w",
      required: true,
      description: "切り替え先のworkspaceId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await switchWorkspace(resolveIpcEndpoint(), ctx.values.workspace);
    if (!result.ok) {
      failAndExit(`workspace switchに失敗しました: ${result.error}`);
    }
  },
});
