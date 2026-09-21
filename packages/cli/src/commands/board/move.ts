import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { moveBoard, moveBoardToWorkspace, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "move",
  description: "Boardの表示順を1つ上/下へ移動する、または別のワークスペースへ移す",
  args: {
    board: {
      type: "string",
      short: "b",
      description:
        "移動するboardId（niwaterm listで確認）。省略時はこのコマンドを実行したタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）",
    },
    up: {
      type: "boolean",
      description:
        "1つ上（サイドバーの並びで手前）へ移動する。--down/--to-workspaceとは同時指定不可",
    },
    down: {
      type: "boolean",
      description: "1つ下（サイドバーの並びで後ろ）へ移動する。--up/--to-workspaceとは同時指定不可",
    },
    "to-workspace": {
      type: "string",
      description:
        "移し先のworkspaceId（niwaterm listで確認）。そのワークスペースの末尾へ付く。--up/--downとは同時指定不可",
    },
  },
  run: async (ctx) => {
    const { up, down } = ctx.values;
    const toWorkspace = ctx.values["to-workspace"];
    const specified = [up, down, toWorkspace !== undefined].filter(Boolean).length;
    if (specified > 1) {
      failAndExit("board moveに失敗しました: --up・--down・--to-workspaceは同時に指定できません");
    }
    if (specified === 0) {
      failAndExit(
        "board moveに失敗しました: --up・--down・--to-workspaceのいずれかを指定してください",
      );
    }
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "board move", { boardId: ctx.values.board });
    if (toWorkspace !== undefined) {
      const result = await moveBoardToWorkspace(endpoint, await target.boardId(), toWorkspace);
      if (!result.ok) {
        failAndExit(`board moveに失敗しました: ${result.error}`);
      }
      // 副作用としてワークスペースが1つ消えるのは気づきにくいので、成功時でも必ず知らせる
      if (result.sourceWorkspaceClosed) {
        console.log("移動元のワークスペースは空になったため閉じました");
      }
      return;
    }
    const result = await moveBoard(endpoint, await target.boardId(), up ? "up" : "down");
    if (!result.ok) {
      failAndExit(`board moveに失敗しました: ${result.error}`);
    }
  },
});
