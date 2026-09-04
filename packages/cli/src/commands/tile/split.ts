import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, splitTile } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export default define({
  name: "split",
  description: "指定したタイルを分割する",
  args: {
    tile: {
      type: "string",
      short: "t",
      description:
        "分割対象のtileId（niwaterm listで確認）。省略時はこのコマンドを実行したタブのタイル（niwatermの外から実行した場合はフォーカス中のタイル）",
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
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "tile split", { tileId: ctx.values.tile });
    const result = await splitTile(
      endpoint,
      await target.tileId(),
      ctx.values.orientation,
      ctx.values.cwd,
    );
    if (!result.ok) {
      failAndExit(`tile splitに失敗しました: ${result.error}`);
    }
    console.log(`tile: ${result.tileId}, tab: ${result.tabId}`);
  },
});
