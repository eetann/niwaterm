import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { listWindows, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "list",
  description: "開いているOSウィンドウの一覧を表示",
  run: async () => {
    const result = await listWindows(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`window listに失敗しました: ${result.error}`);
    }
    for (const window of result.windows) {
      const kind = window.persistent ? "main" : "temporary";
      const focused = window.focused ? ", focused" : "";
      console.log(`${window.windowId} (${kind}${focused})`);
      for (const workspaceId of window.workspaceIds) {
        const active = workspaceId === window.activeWorkspaceId ? " (active)" : "";
        console.log(`  ${workspaceId}${active}`);
      }
    }
  },
});
