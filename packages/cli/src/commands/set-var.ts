import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { ipcSocketPath, setTabVar } from "../ipc-client";
import { resolveTabId } from "../resolve-tab";

export default define({
  name: "set-var",
  description: "指定したタブにkey-value変数を設定する（tmuxのペイン変数相当）",
  args: {
    tab: {
      type: "string",
      short: "t",
      description: "対象のtabId（niwaterm listで確認）。省略時はNIWATERM_TAB_ID環境変数を使う",
    },
    key: {
      type: "positional",
      description: "変数名（英数字・_・-・.のみ、1〜128文字）",
    },
    value: {
      type: "positional",
      description: "設定する値",
    },
  },
  run: async (ctx) => {
    const tabId = resolveTabId(ctx.values.tab);
    const result = await setTabVar(ipcSocketPath(), tabId, ctx.values.key, ctx.values.value);
    if (!result.ok) {
      failAndExit(`set-varに失敗しました: ${result.error}`);
    }
  },
});
