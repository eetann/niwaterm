import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, setBoardPhase } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "clear",
  description: "Boardの作業フェーズを解除する",
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
    const target = createTargetResolver(endpoint, "board phase clear", {
      boardId: ctx.values.board,
    });
    const result = await setBoardPhase(endpoint, "clear", { boardId: await target.boardId() });
    if (!result.ok) {
      failAndExit(`board phase clearに失敗しました: ${result.error}`);
    }
  },
});
