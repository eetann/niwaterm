import { describe, expect, test } from "bun:test";
import type { WindowListEntry } from "../../ipc-client";
import { formatWindowList } from "./list";

function window(overrides: Partial<WindowListEntry> = {}): WindowListEntry {
  return {
    windowId: "window-1",
    persistent: true,
    focused: true,
    workspaceIds: ["workspace-1"],
    activeWorkspaceId: "workspace-1",
    workspaceNames: {},
    ...overrides,
  };
}

describe("formatWindowList", () => {
  test("名前を付けたワークスペースにはworkspaceIdの後ろへ名前を添える", () => {
    const lines = formatWindowList([
      window({
        workspaceIds: ["workspace-1", "workspace-2"],
        activeWorkspaceId: "workspace-2",
        workspaceNames: { "workspace-1": "dev" },
      }),
    ]);
    expect(lines).toEqual([
      "window-1 (main, focused)",
      '  workspace-1 "dev"',
      "  workspace-2 (active)",
    ]);
  });

  test("一時ウィンドウ・非フォーカスのウィンドウも並べる", () => {
    const lines = formatWindowList([
      window({ focused: false }),
      window({
        windowId: "window-2",
        persistent: false,
        workspaceIds: ["workspace-2"],
        activeWorkspaceId: "workspace-2",
        workspaceNames: { "workspace-2": "scratch" },
      }),
    ]);
    expect(lines).toEqual([
      "window-1 (main)",
      "  workspace-1 (active)",
      "window-2 (temporary, focused)",
      '  workspace-2 "scratch" (active)',
    ]);
  });
});
