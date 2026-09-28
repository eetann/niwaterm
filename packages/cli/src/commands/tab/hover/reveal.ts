import { define } from "gunshi";
import { failAndExit } from "../../../cli-error";
import { resolveIpcEndpoint, revealHoverButton } from "../../../ipc-client";
import { createTargetResolver } from "../../../resolve-target";

export default define({
  name: "reveal",
  description:
    "ホバーボタンを出したままにする（マウスを寄せた状態と同じ表示。目視・スクリーンショット確認用）",
  args: {
    position: {
      type: "enum",
      choices: [
        "top-left",
        "top",
        "top-right",
        "left",
        "right",
        "bottom-left",
        "bottom",
        "bottom-right",
      ] as const,
      short: "p",
      required: true,
      description: "出す位置（タブの表示領域の端8方向）",
    },
    tab: {
      type: "string",
      short: "t",
      description:
        "対象のtabId（niwaterm listで確認）。省略時はこのコマンドを実行しているタブ（niwaterm外からならフォーカス中タイルのアクティブタブ）",
    },
  },
  run: async (ctx) => {
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "tab hover reveal", { tabId: ctx.values.tab });
    const result = await revealHoverButton(endpoint, await target.tabId(), ctx.values.position);
    if (!result.ok) {
      failAndExit(`tab hover revealに失敗しました: ${result.error}`);
    }
  },
});
