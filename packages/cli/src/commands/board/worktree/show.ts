import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, setBoardWorktree } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "show",
  description: "Boardに紐づくワークツリーを表示する",
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
    const target = createTargetResolver(endpoint, "board worktree show", {
      boardId: ctx.values.board,
    });
    const result = await setBoardWorktree(endpoint, "show", { boardId: await target.boardId() });
    if (!result.ok) {
      failAndExit(`board worktree showに失敗しました: ${result.error}`);
    }
    const missing = result.missing ? "\t[missing]" : "";
    console.log(`board: ${result.boardId}\tworktree: ${result.worktreePath ?? "none"}${missing}`);
  },
});
