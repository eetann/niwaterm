import { define } from "gunshi";
import { runBoardStartup } from "./run";

export default define({
  name: "restore",
  description:
    "起動時に保存した骨格を復元するよう戻す（既定の挙動。プリセットの紐づけは残るが組み直しはしない）",
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
        "紐づけ直すプリセット名（niwaterm layout listで確認）。省略時は現在紐づいているプリセット（解決元込み）を引き継ぐ",
    },
    cwd: {
      type: "string",
      description:
        "--presetの解決元を探す起点ディレクトリ（省略時はこのコマンドを実行したディレクトリ）",
    },
  },
  run: (ctx) =>
    runBoardStartup("restore", "board startup restore", {
      boardId: ctx.values.board,
      preset: ctx.values.preset,
      cwd: ctx.values.cwd,
    }),
});
