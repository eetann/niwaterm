import { define } from "gunshi";
import { runBoardStartup } from "./run";

export default define({
  name: "clear",
  description: "起動時レイアウトのプリセットの紐づけを解除する",
  args: {
    board: {
      type: "string",
      short: "b",
      description: "対象のboardId（省略時は現在アクティブなBoard）",
    },
  },
  run: (ctx) => runBoardStartup("clear", "board startup clear", { boardId: ctx.values.board }),
});
