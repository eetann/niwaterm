import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { browserScreenshot, ipcSocketPath } from "../ipc-client";

export default define({
  name: "browser-screenshot",
  description:
    "指定したブラウザタブの現在URLをheadlessで開き直してスクリーンショットをPNGファイルに保存する",
  args: {
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtabId（niwaterm listで確認）",
    },
    out: {
      type: "string",
      short: "o",
      required: true,
      description: "保存先PNGファイルパス",
    },
  },
  run: async (ctx) => {
    const result = await browserScreenshot(ipcSocketPath(), ctx.values.tab);
    if (!result.ok) {
      failAndExit(`browser-screenshotに失敗しました: ${result.error}`);
    }
    await Bun.write(ctx.values.out, result.data);
    console.log(`saved: ${ctx.values.out}`);
  },
});
