import { define } from "gunshi";
import { ipcSocketPath, sendKeys } from "../ipc-client";

export default define({
  name: "send-keys",
  description: "指定したタブへキーを送信する（tmux send-keys相当）",
  args: {
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "送信先のtabId（niwaterm listで確認）",
    },
    keys: {
      type: "positional",
      multiple: true,
      description:
        "送信するリテラル文字列・特殊キー名（Enter, C-c, Escape, Tab, Space, Up等）を並べる",
    },
  },
  run: async (ctx) => {
    const keys = ctx.values.keys ?? [];
    if (keys.length === 0) {
      console.error(
        "送信するキーを1つ以上指定してください（例: niwaterm send-keys --tab tab-3 'ls -la' Enter）",
      );
      process.exit(1);
    }
    const result = await sendKeys(ipcSocketPath(), ctx.values.tab, keys);
    if (!result.ok) {
      console.error(`send-keysに失敗しました: ${result.error}`);
      process.exit(1);
    }
  },
});
