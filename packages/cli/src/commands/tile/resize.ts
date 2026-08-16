import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resizeTile, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "resize",
  description: "指定したタイルを指定方向へ拡大する（tmuxのresize-pane相当）",
  args: {
    tile: {
      type: "string",
      short: "t",
      required: true,
      description: "リサイズ対象のtileId（niwaterm listで確認）",
    },
    direction: {
      type: "enum",
      choices: ["up", "down", "left", "right"] as const,
      short: "d",
      required: true,
      description:
        "拡大する方向。この方向の軸に一致するsplitが祖先に無い場合は失敗する（例: 単一タイルのワークスペース）",
    },
    amount: {
      type: "number",
      description: "ratioの増減幅（0より大きく1以下）。省略時は既定値",
    },
  },
  run: async (ctx) => {
    const { tile, direction, amount } = ctx.values;
    const result = await resizeTile(
      resolveIpcEndpoint(),
      tile,
      direction as NonNullable<typeof direction>,
      amount,
    );
    if (!result.ok) {
      failAndExit(`tile resizeに失敗しました: ${result.error}`);
    }
  },
});
