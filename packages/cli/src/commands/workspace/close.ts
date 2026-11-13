import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { closeWorkspace, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "close",
  description: "指定したワークスペースを閉じる（最後の1つは閉じられない）",
  args: {
    workspace: {
      type: "string",
      short: "w",
      description:
        "閉じるワークスペース（workspaceIdか名前の一部。niwaterm listで確認）。省略時はこのコマンドを実行したタブが属するワークスペース（niwatermの外から実行した場合はアクティブなワークスペース）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "workspace close", {
      workspaceId: ctx.values.workspace,
    });
    const result = await closeWorkspace(endpoint, await target.workspaceId());
    if (!result.ok) {
      failAndExit(`workspace closeに失敗しました: ${result.error}`);
    }
  },
});
