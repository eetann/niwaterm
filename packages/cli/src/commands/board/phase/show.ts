import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, setBoardPhase } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "show",
  description: "Boardに設定されている作業フェーズを表示する（未設定なら空行）",
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
    const target = createTargetResolver(endpoint, "board phase show", {
      boardId: ctx.values.board,
    });
    const result = await setBoardPhase(endpoint, "show", { boardId: await target.boardId() });
    if (!result.ok) {
      failAndExit(`board phase showに失敗しました: ${result.error}`);
    }
    console.log(result.phase ?? "");
  },
});
