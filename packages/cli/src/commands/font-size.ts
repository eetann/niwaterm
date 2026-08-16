import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { adjustFontSize, resolveIpcEndpoint } from "../ipc-client";

export default define({
  name: "font-size",
  description:
    "ターミナルのフォントサイズを拡大・縮小・リセットする（configファイルのappearance.fontSizeは変更しない実行時ズーム）",
  args: {
    action: {
      type: "enum",
      choices: ["increase", "decrease", "reset"] as const,
      required: true,
      description: "実行する操作",
    },
  },
  run: async (ctx) => {
    const result = await adjustFontSize(resolveIpcEndpoint(), ctx.values.action);
    if (!result.ok) {
      failAndExit(`font-sizeに失敗しました: ${result.error}`);
    }
    console.log(`font size: ${result.fontSize}px`);
  },
});
