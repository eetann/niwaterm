import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { cycleTab, resolveIpcEndpoint, switchTab } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "switch",
  description:
    "指定したタイル内でアクティブタブを切り替える（--tabで直接指定、または--directionで前後のタブへ巡回）",
  args: {
    tile: {
      type: "string",
      description:
        "対象のtileId（niwaterm listで確認）。省略時は--tabのタブが属するタイル、--direction指定時はこのコマンドを実行したタブのタイル",
    },
    tab: {
      type: "string",
      short: "t",
      description: "切り替え先のtabId（niwaterm listで確認）。--directionとは同時指定不可",
    },
    direction: {
      type: "enum",
      choices: ["next", "prev"] as const,
      short: "d",
      description:
        "タイル内のタブ並び順で1つ次/前のタブへ切り替える（端は反対側へ回り込む）。--tabとは同時指定不可",
    },
  },
  run: async (ctx) => {
    const { tile, tab, direction } = ctx.values;
    if (tab !== undefined && direction !== undefined) {
      failAndExit("tab switchに失敗しました: --tabと--directionは同時に指定できません");
    }
    const endpoint = resolveIpcEndpoint();
    if (direction !== undefined) {
      const target = createTargetResolver(endpoint, "tab switch", { tileId: tile });
      const result = await cycleTab(endpoint, await target.tileId(), direction);
      if (!result.ok) {
        failAndExit(`tab switchに失敗しました: ${result.error}`);
      }
      return;
    }
    if (tab === undefined) {
      failAndExit("tab switchに失敗しました: --tabか--directionのどちらかを指定してください");
    }
    const target = createTargetResolver(endpoint, "tab switch", { tileId: tile, tabId: tab });
    const result = await switchTab(endpoint, await target.tileId(), tab);
    if (!result.ok) {
      failAndExit(`tab switchに失敗しました: ${result.error}`);
    }
  },
});
