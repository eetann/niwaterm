import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { listWindows, resolveIpcEndpoint, type WindowListEntry } from "../../ipc-client";

export function formatWindowList(windows: WindowListEntry[]): string[] {
  return windows.flatMap((window) => {
    const kind = window.persistent ? "main" : "temporary";
    const focused = window.focused ? ", focused" : "";
    return [
      `${window.windowId} (${kind}${focused})`,
      ...window.workspaceIds.map((workspaceId) => {
        const name = window.workspaceNames[workspaceId];
        const nameSuffix = name ? ` "${name}"` : "";
        const active = workspaceId === window.activeWorkspaceId ? " (active)" : "";
        return `  ${workspaceId}${nameSuffix}${active}`;
      }),
    ];
  });
}

export default define({
  name: "list",
  description: "開いているOSウィンドウの一覧を表示",
  run: async () => {
    const result = await listWindows(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`window listに失敗しました: ${result.error}`);
    }
    for (const line of formatWindowList(result.windows)) {
      console.log(line);
    }
  },
});
