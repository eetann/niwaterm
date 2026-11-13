import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, switchWorkspace } from "../../ipc-client";
import { resolveWorkspaceQuery } from "../../resolve-workspace";

export default define({
  name: "switch",
  description: "指定したワークスペースへ切り替える",
  args: {
    workspace: {
      type: "string",
      short: "w",
      required: true,
      description: "切り替え先のワークスペース（workspaceIdか名前の一部。niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const workspaceId = await resolveWorkspaceQuery(
      endpoint,
      "workspace switch",
      ctx.values.workspace,
    );
    const result = await switchWorkspace(endpoint, workspaceId);
    if (!result.ok) {
      failAndExit(`workspace switchに失敗しました: ${result.error}`);
    }
  },
});
