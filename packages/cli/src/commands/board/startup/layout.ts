import { define } from "gunshi";
import { runBoardStartup } from "./run";

export default define({
  name: "layout",
  description:
    "起動時にレイアウトプリセットでBoardを組み直すよう紐づける（プリセットのcommandも再実行される）",
  args: {
    board: {
      type: "string",
      short: "b",
      description: "対象のboardId（省略時は現在アクティブなBoard）",
    },
    preset: {
      type: "string",
      short: "p",
      description:
        "紐づけるプリセット名（niwaterm layout listで確認）。省略時は現在紐づいているプリセット（解決元込み）を引き継ぐ",
    },
    cwd: {
      type: "string",
      description:
        "--presetの解決元を探す起点ディレクトリ（省略時はこのコマンドを実行したディレクトリ）",
    },
    trust: {
      type: "boolean",
      description:
        "プロジェクトローカルのプリセットを紐づける際の確認をスキップする（非対話環境用）",
    },
  },
  run: (ctx) =>
    runBoardStartup("layout", "board startup layout", {
      boardId: ctx.values.board,
      preset: ctx.values.preset,
      cwd: ctx.values.cwd,
      trust: ctx.values.trust,
    }),
});
