import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { closeBoard, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "close",
  description: "指定したBoardを閉じる（ワークスペース内最後の1つは閉じられない）",
  args: {
    board: {
      type: "string",
      short: "b",
      required: true,
      description: "閉じるboardId（board new実行時に表示される値で確認）",
    },
  },
  run: async (ctx) => {
    const result = await closeBoard(resolveIpcEndpoint(), ctx.values.board);
    if (!result.ok) {
      failAndExit(`board closeに失敗しました: ${result.error}`);
    }
  },
});
