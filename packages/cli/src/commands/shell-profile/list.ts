import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { listShellProfiles, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "list",
  description: "利用可能なシェルプロファイル（tab new --shellで指定するid）の一覧を表示",
  run: async () => {
    const result = await listShellProfiles(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`shell-profile listに失敗しました: ${result.error}`);
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
