import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, setBoardStatus } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "status",
  description: "Boardに作業フェーズ（サイドバーのバッジ）を設定・解除・表示する",
  args: {
    board: {
      type: "string",
      short: "b",
      description:
        "対象のboardId。省略時はこのコマンドを実行したタブが属するBoard（niwatermの外から実行した場合はアクティブなBoard）",
    },
    clear: {
      type: "boolean",
      description: "ステータスを解除する",
    },
    status: {
      type: "positional",
      required: false,
      description:
        "設定する値。設定ファイルのboard.statusesのid（未定義の任意の文字列も可）。省略時は現在の値を表示する",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "board status", { boardId: ctx.values.board });
    const status = ctx.values.status;
    if (ctx.values.clear && status !== undefined) {
      failAndExit("board statusに失敗しました: --clearと値の指定は同時に使えません");
    }
    const mode = ctx.values.clear ? "clear" : status === undefined ? "show" : "set";
    const result = await setBoardStatus(endpoint, mode, {
      boardId: await target.boardId(),
      ...(status !== undefined ? { status } : {}),
    });
    if (!result.ok) {
      failAndExit(`board statusに失敗しました: ${result.error}`);
    }
    // set/clearは結果が画面（サイドバー）に出るため、表示するのはshowのときだけにする
    if (mode === "show") console.log(result.status ?? "");
  },
});
