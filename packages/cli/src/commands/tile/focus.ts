import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { focusDirection, focusTile, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "focus",
  description: "タイルへフォーカスを移す（--tileで直接指定、または--directionで隣接方向を指定）",
  args: {
    tile: {
      type: "string",
      short: "t",
      description:
        "フォーカスするtileId（niwaterm listで確認）。--directionとは同時指定不可。どちらも省略した場合はこのコマンドを実行したタブのタイルへフォーカスを移す",
    },
    direction: {
      type: "enum",
      choices: ["up", "down", "left", "right"] as const,
      short: "d",
      description:
        "現在フォーカス中のタイルから見て指定方向にある最も近いタイルへフォーカスを移す。該当タイルが無ければ何もしない（エラーにはならない）。--tileとは同時指定不可",
    },
  },
  run: async (ctx) => {
    const { tile, direction } = ctx.values;
    if (tile !== undefined && direction !== undefined) {
      failAndExit("tile focusに失敗しました: --tileと--directionは同時に指定できません");
    }
    const endpoint = resolveIpcEndpoint();
    if (direction !== undefined) {
      const result = await focusDirection(endpoint, direction);
      if (!result.ok) {
        failAndExit(`tile focusに失敗しました: ${result.error}`);
      }
      return;
    }
    const target = createTargetResolver(endpoint, "tile focus", { tileId: tile });
    const result = await focusTile(endpoint, await target.tileId());
    if (!result.ok) {
      failAndExit(`tile focusに失敗しました: ${result.error}`);
    }
  },
});
