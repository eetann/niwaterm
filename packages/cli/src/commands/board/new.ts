import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { newBoard, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "new",
  description: "新規Boardを作成し、アクティブにする",
  args: {
    workspace: {
      type: "string",
      short: "w",
      description: "作成先のworkspaceId（省略時は現在アクティブなワークスペース）",
    },
    cwd: {
      type: "string",
      description: "最初のタブの作業ディレクトリ（省略時はOS標準）",
    },
  },
  run: async (ctx) => {
    const result = await newBoard(resolveIpcEndpoint(), ctx.values.workspace, ctx.values.cwd);
    if (!result.ok) {
      failAndExit(`board newに失敗しました: ${result.error}`);
    }
    console.log(`board: ${result.boardId}`);
  },
});
