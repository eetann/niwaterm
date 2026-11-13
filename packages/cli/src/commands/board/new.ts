import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { newBoard, resolveIpcEndpoint } from "../../ipc-client";
import { resolveWorkspaceQuery } from "../../resolve-workspace";

export default define({
  name: "new",
  description: "新規Boardを作成し、アクティブにする",
  args: {
    workspace: {
      type: "string",
      short: "w",
      description:
        "作成先のワークスペース（workspaceIdか名前の一部。省略時は現在アクティブなワークスペース）",
    },
    cwd: {
      type: "string",
      description: "最初のタブの作業ディレクトリ（省略時はOS標準）",
    },
    name: {
      type: "string",
      short: "n",
      description: "Boardの名前（省略時は設定board.namingによる自動名）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const workspace = ctx.values.workspace;
    const result = await newBoard(endpoint, {
      ...(workspace !== undefined
        ? { workspaceId: await resolveWorkspaceQuery(endpoint, "board new", workspace) }
        : {}),
      ...(ctx.values.cwd !== undefined ? { cwd: ctx.values.cwd } : {}),
      ...(ctx.values.name !== undefined ? { name: ctx.values.name } : {}),
    });
    if (!result.ok) {
      failAndExit(`board newに失敗しました: ${result.error}`);
    }
    console.log(`board: ${result.boardId}`);
  },
});
