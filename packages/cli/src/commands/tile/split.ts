import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, splitTile } from "../../ipc-client";

export default define({
  name: "split",
  description: "指定したタイルを分割する",
  args: {
    tile: {
      type: "string",
      short: "t",
      required: true,
      description: "分割対象のtileId（niwaterm listで確認）",
    },
    orientation: {
      type: "enum",
      choices: ["horizontal", "vertical"] as const,
      default: "vertical",
      description: "分割方向（デフォルト: vertical）",
    },
    cwd: {
      type: "string",
      description:
        "新規タブの作業ディレクトリ（省略時は分割対象タイルのアクティブタブが実際にいるディレクトリ。シェル統合が未導入等で不明な場合はOS標準）",
    },
  },
  run: async (ctx) => {
    const result = await splitTile(
      resolveIpcEndpoint(),
      ctx.values.tile,
      ctx.values.orientation,
      ctx.values.cwd,
    );
    if (!result.ok) {
      failAndExit(`tile splitに失敗しました: ${result.error}`);
    }
    console.log(`tile: ${result.tileId}, tab: ${result.tabId}`);
  },
});
