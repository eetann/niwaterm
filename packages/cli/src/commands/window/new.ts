import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { newWindow, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "new",
  description: "新しいOSウィンドウを開く（前回の状態は復元せず、閉じても何も残らない）",
  args: {
    cwd: {
      type: "string",
      description: "最初のタブの作業ディレクトリ。省略時は既定のディレクトリ",
    },
  },
  run: async (ctx) => {
    const result = await newWindow(resolveIpcEndpoint(), ctx.values.cwd);
    if (!result.ok) {
      failAndExit(`window newに失敗しました: ${result.error}`);
    }
    console.log(`window: ${result.windowId}`);
  },
});
