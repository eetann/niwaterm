import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { closeBoard, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "close",
  description: "指定したBoardを閉じる（ワークスペース内最後の1つは閉じられない）",
  args: {
    board: {
      type: "string",
      short: "b",
      description:
        "閉じるboardId（board new実行時に表示される値で確認）。省略時はこのコマンドを実行したタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "board close", { boardId: ctx.values.board });
    const result = await closeBoard(endpoint, await target.boardId());
    if (!result.ok) {
      failAndExit(`board closeに失敗しました: ${result.error}`);
    }
  },
});
