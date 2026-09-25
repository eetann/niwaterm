import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, setBoardPhase } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "set",
  description: "Boardに作業フェーズ（サイドバーのバッジ）を設定する",
  args: {
    board: {
      type: "string",
      short: "b",
      description:
        "対象のboardId。省略時はこのコマンドを実行したタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）",
    },
    phase: {
      type: "positional",
      description: "設定する値。設定ファイルのboard.phasesのid（未定義の任意の文字列も可）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "board phase set", { boardId: ctx.values.board });
    const result = await setBoardPhase(endpoint, "set", {
      boardId: await target.boardId(),
      phase: ctx.values.phase,
    });
    if (!result.ok) {
      failAndExit(`board phase setに失敗しました: ${result.error}`);
    }
  },
});
