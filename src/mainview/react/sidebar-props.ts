import { listLeaves, type TabId, type TileId } from "../../bun/tile-layout";
import type { WorkspaceId, WorkspaceListEntry } from "../../bun/workspace-manager";

export interface SidebarTabRowItem {
  tabId: TabId;
  tileId: TileId;
  label: string;
  active: boolean;
}

export interface SidebarWorkspaceItem {
  workspaceId: WorkspaceId;
  label: string;
  active: boolean;
  tabs: SidebarTabRowItem[];
}

/**
 * renderSidebar()旧実装のラベル整形・active判定ロジックを、DOM非依存の純粋関数として抽出したもの。
 * サイドバーは全ワークスペースをフラットに列挙する（アクティブワークスペースのみのタイル木とは別）。
 */
export function buildSidebarWorkspaceItems(
  workspaces: WorkspaceListEntry[],
  currentActiveWorkspaceId: WorkspaceId | null,
): SidebarWorkspaceItem[] {
  return workspaces.map((entry, workspaceIndex) => ({
    workspaceId: entry.workspaceId,
    label: `Workspace ${workspaceIndex + 1}`,
    active: entry.workspaceId === currentActiveWorkspaceId,
    tabs: listLeaves(entry.layout).flatMap((leaf, tileIndex) => {
      const branch = entry.tileVars[leaf.id]?.["branch"];
      return leaf.tabIds.map((tabId, tabIndex) => {
        const label = `Tile ${tileIndex + 1} / Tab ${tabIndex + 1}`;
        return {
          tabId,
          tileId: leaf.id,
          label: branch ? `${label} · ${branch}` : label,
          active: entry.workspaceId === currentActiveWorkspaceId && tabId === leaf.activeTabId,
        };
      });
    }),
  }));
}
