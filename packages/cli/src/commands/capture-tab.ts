import { define } from "gunshi";
import { captureTab, ipcSocketPath } from "../ipc-client";

export default define({
  name: "capture-tab",
  description: "指定したタブの画面内容をテキストで取得する（tmux capture-pane相当）",
  args: {
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtabId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const result = await captureTab(ipcSocketPath(), ctx.values.tab);
    if (!result.ok) {
      console.error(`capture-tabに失敗しました: ${result.error}`);
      process.exit(1);
    }
    console.log(result.text);
  },
});
