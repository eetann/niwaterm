import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { focusDirection, resolveIpcEndpoint } from "../ipc-client";

export default define({
  name: "focus-direction",
  description: "現在フォーカス中のタイルから見て上下左右のタイルへフォーカスを移す",
  args: {
    direction: {
      type: "enum",
      choices: ["up", "down", "left", "right"] as const,
      required: true,
      description: "フォーカス先の方向",
    },
  },
  run: async (ctx) => {
    const result = await focusDirection(resolveIpcEndpoint(), ctx.values.direction);
    if (!result.ok) {
      failAndExit(`focus-directionに失敗しました: ${result.error}`);
    }
  },
});
