import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { renameWorkspace, resolveIpcEndpoint } from "../ipc-client";

export default define({
  name: "rename-workspace",
  description: "指定したワークスペースの名前を変更する",
  args: {
    workspace: {
      type: "string",
      short: "w",
      required: true,
      description: "対象のworkspaceId（niwaterm listで確認）",
    },
    name: {
      type: "positional",
      description: "設定する名前。空文字列を指定するとデフォルトの連番ラベルへ戻る",
    },
  },
  run: async (ctx) => {
    const result = await renameWorkspace(
      resolveIpcEndpoint(),
      ctx.values.workspace,
      ctx.values.name,
    );
    if (!result.ok) {
      failAndExit(`rename-workspaceに失敗しました: ${result.error}`);
    }
  },
});
