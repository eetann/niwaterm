import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { closeWindow, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "close",
  description: "指定したOSウィンドウを閉じる（最後の1つを閉じるとniwatermが終了する）",
  args: {
    window: {
      type: "string",
      required: true,
      description: "閉じるwindowId（niwaterm window listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await closeWindow(resolveIpcEndpoint(), ctx.values.window);
    if (!result.ok) {
      failAndExit(`window closeに失敗しました: ${result.error}`);
    }
  },
});
