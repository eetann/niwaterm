import { cn } from "@/lib/utils";
import type { TileId } from "../../bun/tile-layout";
import type { WorkspaceId } from "../../bun/workspace-manager";
import type { SidebarWorkspaceItem } from "./sidebar-props";

export interface SidebarWorkspaceListProps {
  workspaces: SidebarWorkspaceItem[];
  onSelectWorkspaceHeader: (workspaceId: WorkspaceId) => void;
  onSelectTab: (workspaceId: WorkspaceId, tileId: TileId, tabId: string) => void;
}

export function SidebarWorkspaceList({
  workspaces,
  onSelectWorkspaceHeader,
  onSelectTab,
}: SidebarWorkspaceListProps) {
  return (
    <>
      {workspaces.map((workspace) => (
        <div key={workspace.workspaceId}>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onSelectWorkspaceHeader(workspace.workspaceId)}
            className={cn(
              "w-full px-2 py-1.5 text-left text-xs font-bold text-muted-foreground hover:text-foreground",
              workspace.active && "text-foreground",
            )}
          >
            {workspace.label}
          </button>
          <div>
            {workspace.tabs.map((tab) => (
              <button
                key={tab.tabId}
                type="button"
                tabIndex={-1}
                onClick={() => onSelectTab(workspace.workspaceId, tab.tileId, tab.tabId)}
                className={cn(
                  "block w-full truncate px-2 py-1 pl-4 text-left text-xs whitespace-nowrap text-muted-foreground hover:text-foreground",
                  tab.active && "bg-background text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
