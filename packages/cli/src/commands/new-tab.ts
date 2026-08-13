import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { resolveIpcEndpoint, newTab } from "../ipc-client";

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
    shell: {
      type: "string",
      short: "s",
      description:
        "指定したシェルプロファイル（idはniwaterm shell-profilesで確認）でターミナルタブを作成する（--url・--custom-viewとは同時指定不可）",
    },
    cwd: {
      type: "string",
      description:
        "作成するターミナルタブの作業ディレクトリ（--shellと併用可。--url・--custom-viewとは同時指定不可）",
    },
  },
  run: async (ctx) => {
    const exclusiveFlags = [
      ctx.values.url !== undefined,
      ctx.values["custom-view"] === true,
      ctx.values.shell !== undefined,
    ].filter(Boolean).length;
    if (exclusiveFlags > 1) {
      failAndExit("new-tabに失敗しました: --url・--custom-view・--shellは同時に指定できません");
    }
    if (
      ctx.values.cwd !== undefined &&
      (ctx.values.url !== undefined || ctx.values["custom-view"])
    ) {
      failAndExit("new-tabに失敗しました: --cwdは--url・--custom-viewと同時に指定できません");
    }
    const result = await newTab(
      resolveIpcEndpoint(),
      ctx.values.tile,
      ctx.values.url,
      ctx.values["custom-view"],
      ctx.values.shell,
      ctx.values.cwd,
    );
    if (!result.ok) {
      failAndExit(`new-tabに失敗しました: ${result.error}`);
    }
    console.log(`tab: ${result.tabId}`);
  },
});
