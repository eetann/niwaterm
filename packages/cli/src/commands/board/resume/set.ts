import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, setBoardResume } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "set",
  description:
    "実行中だったコマンドを起動時に打ち直すかをBoardに設定する。設定ファイル（resume.enabled・レイアウトプリセットのresume）より優先される",
  args: {
    board: {
      type: "string",
      short: "b",
      description:
        "対象のboardId。省略時はこのコマンドを実行したタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）",
    },
    value: {
      type: "positional",
      choices: ["on", "off"] as const,
      description: "on で打ち直す、off で打ち直さない",
    },
  },
  run: async (ctx) => {
    const value = ctx.values.value;
    if (value !== "on" && value !== "off") {
      failAndExit(`board resume setに失敗しました: on か off を指定してください: ${value ?? ""}`);
    }
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "board resume set", {
      boardId: ctx.values.board,
    });
    const result = await setBoardResume(endpoint, "set", {
      boardId: await target.boardId(),
      resume: value === "on",
    });
    if (!result.ok) {
      failAndExit(`board resume setに失敗しました: ${result.error}`);
    }
  },
});
