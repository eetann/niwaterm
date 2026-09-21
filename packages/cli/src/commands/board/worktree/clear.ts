import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, setBoardWorktree } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "clear",
  description: "Boardに紐づくワークツリーの設定を解除する",
  args: {
    board: {
      type: "string",
      short: "b",
      description:
        "対象のboardId。省略時はこのコマンドを実行したタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "board worktree clear", {
      boardId: ctx.values.board,
    });
    const result = await setBoardWorktree(endpoint, "clear", { boardId: await target.boardId() });
    if (!result.ok) {
      failAndExit(`board worktree clearに失敗しました: ${result.error}`);
    }
    console.log(`board: ${result.boardId}\tworktree: none`);
  },
});
