import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { ipcSocketPath, listShellProfiles } from "../ipc-client";

export default define({
  name: "shell-profiles",
  description: "利用可能なシェルプロファイル（new-tab --shellで指定するid）の一覧を表示",
  run: async () => {
    const result = await listShellProfiles(ipcSocketPath());
    if (!result.ok) {
      failAndExit(`niwatermに接続できませんでした: ${result.error}`);
    }
    if (result.profiles.length === 0) {
      console.log("(シェルプロファイルは設定されていません)");
      return;
    }
    for (const profile of result.profiles) {
      console.log(`${profile.id}\t${profile.name}\t${profile.command}`);
    }
  },
});
