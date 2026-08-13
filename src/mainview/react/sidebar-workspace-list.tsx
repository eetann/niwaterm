import { cn } from "@/lib/utils";
import type { TileId } from "../../bun/tile-layout";
import type { WorkspaceId } from "../../bun/workspace-manager";
import { agentStatusDotClass, type SidebarWorkspaceItem } from "./sidebar-props";

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
                title={tab.agent ? `${tab.agent.agent}: ${tab.agent.status}` : undefined}
                className={cn(
                  "flex w-full items-center gap-1.5 px-2 py-1 pl-4 text-left text-xs whitespace-nowrap text-muted-foreground hover:text-foreground",
                  tab.active && "bg-background text-foreground",
                )}
              >
                {tab.agent && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      agentStatusDotClass(tab.agent.status),
                    )}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                {tab.branch && (
                  <span className="shrink-0 truncate text-[10px] text-muted-foreground/70">
                    {tab.branch}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
