import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, zoomTile } from "../../ipc-client";

export default define({
  name: "zoom",
  description:
    "指定したタイルの一時的なズーム表示を切り替える（tmuxのresize-pane -Z相当。他のタイルを隠し画面全体に表示、再実行で解除）",
  args: {
    tile: {
      type: "string",
      short: "t",
      required: true,
      description: "ズーム対象のtileId（niwaterm listで確認）",
    },
  },
  run: async (ctx) => {
    const { tile } = ctx.values;
    const result = await zoomTile(resolveIpcEndpoint(), tile);
    if (!result.ok) {
      failAndExit(`tile zoomに失敗しました: ${result.error}`);
    }
    console.log(result.zoomed ? "zoomed" : "unzoomed");
  },
});
