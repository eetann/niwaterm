import { resolve } from "node:path";
import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, setBoardWorktree } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "set",
  description: "Boardに紐づくワークツリーのディレクトリを設定する",
  args: {
    path: {
      type: "positional",
      description:
        "紐づけるディレクトリ。相対パスはこのコマンドを実行したディレクトリ起点で解決する",
    },
    board: {
      type: "string",
      short: "b",
      description:
        "対象のboardId。省略時はこのコマンドを実行したタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "board worktree set", {
      boardId: ctx.values.board,
    });
    const result = await setBoardWorktree(endpoint, "set", {
      boardId: await target.boardId(),
      path: resolve(process.cwd(), ctx.values.path),
    });
    if (!result.ok) {
      failAndExit(`board worktree setに失敗しました: ${result.error}`);
    }
    console.log(`board: ${result.boardId}\tworktree: ${result.worktreePath}`);
  },
});
