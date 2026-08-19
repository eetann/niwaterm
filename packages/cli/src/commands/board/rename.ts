import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { renameBoard, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "rename",
  description: "指定したBoardの名前を変更する",
  args: {
    board: {
      type: "string",
      short: "b",
      required: true,
      description: "対象のboardId（board new実行時に表示される値で確認）",
    },
    name: {
      type: "positional",
      description: "設定する名前。空文字列を指定するとデフォルトの連番ラベルへ戻る",
    },
  },
  run: async (ctx) => {
    const result = await renameBoard(resolveIpcEndpoint(), ctx.values.board, ctx.values.name);
    if (!result.ok) {
      failAndExit(`board renameに失敗しました: ${result.error}`);
    }
  },
});
