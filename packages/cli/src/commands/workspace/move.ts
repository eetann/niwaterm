import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { moveWorkspace, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "move",
  description: "ワークスペースの表示順を1つ上/下へ移動する",
  args: {
    workspace: {
      type: "string",
      short: "w",
      description:
        "移動するワークスペース（workspaceIdか名前の一部。niwaterm listで確認）。省略時はこのコマンドを実行したタブが属するワークスペース（niwatermの外から実行した場合はアクティブなワークスペース）",
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
      failAndExit("workspace moveに失敗しました: --upと--downは同時に指定できません");
    }
    if (!up && !down) {
      failAndExit("workspace moveに失敗しました: --upまたは--downを指定してください");
    }
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "workspace move", {
      workspaceId: ctx.values.workspace,
    });
    const result = await moveWorkspace(endpoint, await target.workspaceId(), up ? "up" : "down");
    if (!result.ok) {
      failAndExit(`workspace moveに失敗しました: ${result.error}`);
    }
  },
});
