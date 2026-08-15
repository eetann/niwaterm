import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { promotePopup, resolveIpcEndpoint } from "../ipc-client";

export default define({
  name: "popup-promote",
  description:
    "開いているポップアップの中身を、フォーカス中タイルへ通常タブとして編入する（PTYは維持される）",
  run: async () => {
    const result = await promotePopup(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`popup-promoteに失敗しました: ${result.error}`);
    }
    console.log(`tile: ${result.tileId}, tab: ${result.tabId}`);
  },
});
