import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { renameBoard, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "rename",
  description: "指定したBoardの名前を変更する",
  args: {
    board: {
      type: "string",
      short: "b",
      description:
        "対象のboardId（board new実行時に表示される値で確認）。省略時はこのコマンドを実行したタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）",
    },
    name: {
      type: "positional",
      description: "設定する名前。空文字列を指定すると自動名（board.naming）へ戻る",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "board rename", { boardId: ctx.values.board });
    const result = await renameBoard(endpoint, await target.boardId(), ctx.values.name);
    if (!result.ok) {
      failAndExit(`board renameに失敗しました: ${result.error}`);
    }
  },
});
