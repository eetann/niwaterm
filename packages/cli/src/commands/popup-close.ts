import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { closePopup, resolveIpcEndpoint } from "../ipc-client";

export default define({
  name: "popup-close",
  description: "開いているポップアップを閉じる",
  run: async () => {
    const result = await closePopup(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`popup-closeに失敗しました: ${result.error}`);
    }
  },
});
