import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { ipcSocketPath, newTab } from "../ipc-client";

export default define({
  name: "new-tab",
  description: "指定したタイルに新規タブを作成する",
  args: {
    tile: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtileId（niwaterm listで確認）",
    },
    url: {
      type: "string",
      short: "u",
      description:
        "指定すると、そのURLを開くブラウザタブを作成する（省略時は通常のターミナルタブ）",
    },
    "custom-view": {
      type: "boolean",
      short: "c",
      description:
        "指定すると、niwaterm.config.tsのcustomView設定を開くブラウザタブを作成する（--urlとは同時指定不可）",
    },
  },
  run: async (ctx) => {
    if (ctx.values.url !== undefined && ctx.values["custom-view"]) {
      failAndExit("new-tabに失敗しました: --urlと--custom-viewは同時に指定できません");
    }
    const result = await newTab(
      ipcSocketPath(),
      ctx.values.tile,
      ctx.values.url,
      ctx.values["custom-view"],
    );
    if (!result.ok) {
      failAndExit(`new-tabに失敗しました: ${result.error}`);
    }
    console.log(`tab: ${result.tabId}`);
  },
});
