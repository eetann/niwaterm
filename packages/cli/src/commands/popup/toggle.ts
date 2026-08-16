import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, togglePopupVisibility } from "../../ipc-client";

export default define({
  name: "toggle",
  description: "ポップアップの表示/非表示を切り替える（最小化、または再表示。PTYは維持される）",
  run: async () => {
    const result = await togglePopupVisibility(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`popup toggleに失敗しました: ${result.error}`);
    }
    console.log(result.visible ? "popup: visible" : "popup: hidden");
  },
});
