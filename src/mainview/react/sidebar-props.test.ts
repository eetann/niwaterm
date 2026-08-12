import { describe, expect, test } from "bun:test";
import type { TileLeaf } from "../../bun/tile-layout";
import type { WorkspaceListEntry } from "../../bun/workspace-manager";
import { buildSidebarWorkspaceItems } from "./sidebar-props";

function leaf(id: string, tabIds: string[], activeTabId: string): TileLeaf {
  return { kind: "leaf", id, tabIds, activeTabId };
}

function workspace(
  workspaceId: string,
  layout: TileLeaf,
  tileVars: Record<string, Record<string, string>> = {},
): WorkspaceListEntry {
  return {
    workspaceId,
    active: false,
    focusedTileId: layout.id,
    layout,
    tileVars,
  };
}

describe("buildSidebarWorkspaceItems", () => {
  test("ワークスペース・タブのラベルを1始まりの番号で組み立てる", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1", "tab-2"], "tab-2")),
      workspace("ws-2", leaf("tile-2", ["tab-3"], "tab-3")),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-2");

    expect(items).toEqual([
      {
        workspaceId: "ws-1",
        label: "Workspace 1",
        active: false,
        tabs: [
          { tabId: "tab-1", tileId: "tile-1", label: "Tile 1 / Tab 1", active: false },
          { tabId: "tab-2", tileId: "tile-1", label: "Tile 1 / Tab 2", active: false },
        ],
      },
      {
        workspaceId: "ws-2",
        label: "Workspace 2",
        active: true,
        tabs: [{ tabId: "tab-3", tileId: "tile-2", label: "Tile 1 / Tab 1", active: true }],
      },
    ]);
  });

  test("tileVarsにbranchがあればラベルへ付与する", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tile-1": { branch: "main" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tabs[0]?.label).toBe("Tile 1 / Tab 1 · main");
  });

  test("非アクティブワークスペースのタブは常にactive:falseになる", () => {
    const workspaces = [workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"))];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-2");

    expect(items[0]?.active).toBe(false);
    expect(items[0]?.tabs[0]?.active).toBe(false);
  });
});
