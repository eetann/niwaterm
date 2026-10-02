import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, setBoardResume } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "clear",
  description: "Boardの打ち直しの切り替えを解除し、設定ファイルに従わせる",
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
    const target = createTargetResolver(endpoint, "board resume clear", {
      boardId: ctx.values.board,
    });
    const result = await setBoardResume(endpoint, "clear", { boardId: await target.boardId() });
    if (!result.ok) {
      failAndExit(`board resume clearに失敗しました: ${result.error}`);
    }
  },
});
