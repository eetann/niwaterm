import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, zoomTile } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "zoom",
  description:
    "指定したタイルの一時的なズーム表示を切り替える（tmuxのresize-pane -Z相当。他のタイルを隠し画面全体に表示、再実行で解除）",
  args: {
    tile: {
      type: "string",
      short: "t",
      description:
        "ズーム対象のtileId（niwaterm listで確認）。省略時はこのコマンドを実行したタブのタイル（niwatermの外から実行した場合はフォーカス中のタイル）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "tile zoom", { tileId: ctx.values.tile });
    const result = await zoomTile(endpoint, await target.tileId());
    if (!result.ok) {
      failAndExit(`tile zoomに失敗しました: ${result.error}`);
    }
    console.log(result.zoomed ? "zoomed" : "unzoomed");
  },
});
