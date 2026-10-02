import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, setBoardResume } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "show",
  description:
    "Boardの再実行の切り替えを表示する（on / off。切り替えていなければ空行で、設定ファイルに従う）",
  args: {
    board: {
      type: "string",
      short: "b",
      description:
        "対象のboardId。省略時はこのコマンドを実行したタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "board resume show", {
      boardId: ctx.values.board,
    });
    const result = await setBoardResume(endpoint, "show", { boardId: await target.boardId() });
    if (!result.ok) {
      failAndExit(`board resume showに失敗しました: ${result.error}`);
    }
    console.log(result.resume === null ? "" : result.resume ? "on" : "off");
  },
});
