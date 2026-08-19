import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, switchBoard } from "../../ipc-client";

export default define({
  name: "switch",
  description: "指定したBoardへ切り替える",
  args: {
    board: {
      type: "string",
      short: "b",
      required: true,
      description: "切り替え先のboardId（board new実行時に表示される値で確認）",
    },
  },
  run: async (ctx) => {
    const result = await switchBoard(resolveIpcEndpoint(), ctx.values.board);
    if (!result.ok) {
      failAndExit(`board switchに失敗しました: ${result.error}`);
    }
  },
});
