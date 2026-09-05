import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { moveBoard, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "move",
  description: "Boardの表示順を1つ上/下へ移動する",
  args: {
    board: {
      type: "string",
      short: "b",
      description:
        "移動するboardId（niwaterm listで確認）。省略時はこのコマンドを実行したタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）",
    },
    up: {
      type: "boolean",
      description: "1つ上（サイドバーの並びで手前）へ移動する。--downとは同時指定不可",
    },
    down: {
      type: "boolean",
      description: "1つ下（サイドバーの並びで後ろ）へ移動する。--upとは同時指定不可",
    },
  },
  run: async (ctx) => {
    const { up, down } = ctx.values;
    if (up && down) {
      failAndExit("board moveに失敗しました: --upと--downは同時に指定できません");
    }
    if (!up && !down) {
      failAndExit("board moveに失敗しました: --upまたは--downを指定してください");
    }
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "board move", { boardId: ctx.values.board });
    const result = await moveBoard(endpoint, await target.boardId(), up ? "up" : "down");
    if (!result.ok) {
      failAndExit(`board moveに失敗しました: ${result.error}`);
    }
  },
});
