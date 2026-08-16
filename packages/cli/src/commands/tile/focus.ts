import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { focusDirection, focusTile, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "focus",
  description: "タイルへフォーカスを移す（--tileで直接指定、または--directionで隣接方向を指定）",
  args: {
    tile: {
      type: "string",
      short: "t",
      description: "フォーカスするtileId（niwaterm listで確認）。--directionとは同時指定不可",
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
    if ((tile === undefined) === (direction === undefined)) {
      failAndExit(
        "tile focusに失敗しました: --tileまたは--directionのどちらか一方を指定してください",
      );
    }
    const result =
      tile !== undefined
        ? await focusTile(resolveIpcEndpoint(), tile)
        : await focusDirection(resolveIpcEndpoint(), direction as NonNullable<typeof direction>);
    if (!result.ok) {
      failAndExit(`tile focusに失敗しました: ${result.error}`);
    }
  },
});
