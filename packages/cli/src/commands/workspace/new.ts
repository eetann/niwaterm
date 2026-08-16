import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { newWorkspace, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "new",
  description: "新規ワークスペースを作成し、アクティブにする",
  run: async () => {
    const result = await newWorkspace(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`workspace newに失敗しました: ${result.error}`);
    }
    console.log(`workspace: ${result.workspaceId}`);
  },
});
