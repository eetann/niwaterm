import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, toggleStatusBar } from "../../ipc-client";

export default define({
  name: "toggle",
  description:
    "ステータスバーの表示/非表示を切り替える（全ウィンドウ共通で、次回起動時にも引き継ぐ）",
  args: {
    visible: {
      type: "enum",
      choices: ["on", "off"] as const,
      description: "on で出す、off で隠す。省略時は今の逆へ切り替える",
    },
  },
  run: async (ctx) => {
    const { visible } = ctx.values;
    const result = await toggleStatusBar(
      resolveIpcEndpoint(),
      visible === undefined ? undefined : visible === "on",
    );
    if (!result.ok) {
      failAndExit(`status-bar toggleに失敗しました: ${result.error}`);
    }
    console.log(result.visible ? "status-bar: visible" : "status-bar: hidden");
  },
});
