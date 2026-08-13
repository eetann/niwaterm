import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { resolveIpcEndpoint, sendKeys } from "../ipc-client";

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
      failAndExit(
        "送信するキーを1つ以上指定してください（例: niwaterm send-keys --tab tab-3 'ls -la' Enter）",
      );
    }
    const result = await sendKeys(resolveIpcEndpoint(), ctx.values.tab, keys);
    if (!result.ok) {
      failAndExit(`send-keysに失敗しました: ${result.error}`);
    }
  },
});
