import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { renameWorkspace, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "rename",
  description: "指定したワークスペースの名前を変更する",
  args: {
    workspace: {
      type: "string",
      short: "w",
      description:
        "対象のワークスペース（workspaceIdか名前の一部。niwaterm listで確認）。省略時はこのコマンドを実行したタブが属するワークスペース（niwatermの外から実行した場合はアクティブなワークスペース）",
    },
    name: {
      type: "positional",
      description: "設定する名前。空文字列を指定するとデフォルトの連番ラベルへ戻る",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "workspace rename", {
      workspaceId: ctx.values.workspace,
    });
    const result = await renameWorkspace(endpoint, await target.workspaceId(), ctx.values.name);
    if (!result.ok) {
      failAndExit(`workspace renameに失敗しました: ${result.error}`);
    }
  },
});
