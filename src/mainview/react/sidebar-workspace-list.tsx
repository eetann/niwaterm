import { Bot, ChevronRight, GitBranch } from "lucide-react";
import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import type { TabId, TileId } from "../../bun/tile-layout";
import type { WorkspaceId } from "../../bun/workspace-manager";
import {
  agentStatusBadgeClass,
  agentStatusBadgeLabel,
  type SidebarTabRowItem,
  type SidebarWorkspaceItem,
} from "./sidebar-props";

export interface SidebarWorkspaceListProps {
  workspaces: SidebarWorkspaceItem[];
  onSelectWorkspaceHeader: (workspaceId: WorkspaceId) => void;
  onSelectTab: (workspaceId: WorkspaceId, tileId: TileId, tabId: TabId) => void;
}

const COLLAPSED_WORKSPACES_STORAGE_KEY = "niwaterm:sidebarCollapsedWorkspaces";
const COLLAPSED_TILES_STORAGE_KEY = "niwaterm:sidebarCollapsedTiles";

function loadCollapsedIds<T extends string>(storageKey: string): Set<T> {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsedIds(storageKey: string, collapsed: Set<string>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...collapsed]));
  } catch {
    // 保存できなくても致命的ではない（次回起動時は全展開にフォールバックする）
  }
}

export function SidebarWorkspaceList({
  workspaces,
  onSelectWorkspaceHeader,
  onSelectTab,
}: SidebarWorkspaceListProps) {
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<WorkspaceId>>(() =>
    loadCollapsedIds(COLLAPSED_WORKSPACES_STORAGE_KEY),
  );
  const [collapsedTiles, setCollapsedTiles] = useState<Set<TileId>>(() =>
    loadCollapsedIds(COLLAPSED_TILES_STORAGE_KEY),
  );

  function toggleCollapsedWorkspace(workspaceId: WorkspaceId): void {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      saveCollapsedIds(COLLAPSED_WORKSPACES_STORAGE_KEY, next);
      return next;
    });
  }

  function toggleCollapsedTile(tileId: TileId): void {
    setCollapsedTiles((prev) => {
      const next = new Set(prev);
      if (next.has(tileId)) {
        next.delete(tileId);
      } else {
        next.add(tileId);
      }
      saveCollapsedIds(COLLAPSED_TILES_STORAGE_KEY, next);
      return next;
    });
  }

  function renderTabCard(workspaceId: WorkspaceId, tileId: TileId, tab: SidebarTabRowItem) {
    const badgeLabel = tab.agent ? agentStatusBadgeLabel(tab.agent.status) : null;
    return (
      <button
        key={tab.tabId}
        type="button"
        tabIndex={-1}
        onClick={() => onSelectTab(workspaceId, tileId, tab.tabId)}
        title={tab.agent ? `${tab.agent.agent}: ${tab.agent.status}` : undefined}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md px-1.5 py-1 text-left hover:bg-accent",
          tab.active && "bg-accent",
        )}
      >
        <div className="flex items-center gap-1.5">
          {tab.agent && (
            <span
              aria-hidden="true"
              className="flex size-3.5 shrink-0 items-center justify-center rounded bg-muted"
            >
              <Bot className="size-2.5 text-muted-foreground" />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{tab.label}</span>
          {tab.agent && badgeLabel && (
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold whitespace-nowrap",
                agentStatusBadgeClass(tab.agent.status),
              )}
            >
              {badgeLabel}
            </span>
          )}
        </div>
        {tab.agent?.statusText && (
          <div className="line-clamp-2 pl-5 text-[10.5px] leading-tight text-muted-foreground">
            {tab.agent.statusText}
          </div>
        )}
        {tab.agent && tab.branch && (
          <div className="flex items-center gap-1 pl-5 text-[10px] text-muted-foreground/70">
            <GitBranch className="size-2.5 shrink-0" />
            <span className="min-w-0 truncate">{tab.branch}</span>
          </div>
        )}
      </button>
    );
  }

  return (
    <>
      {workspaces.map((workspace) => {
        const isWorkspaceCollapsed = collapsedWorkspaces.has(workspace.workspaceId);
        const totalTabs = workspace.tiles.reduce((sum, tile) => sum + tile.tabs.length, 0);
        // タイルが1つだけのワークスペースが多数派のため、その場合はタイル見出しを省略しタブを直接並べる
        const showTileHeaders = workspace.tiles.length > 1;
        return (
          <div key={workspace.workspaceId}>
            <div className="flex w-full items-center gap-1 py-1.5 pr-2 pl-1">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => toggleCollapsedWorkspace(workspace.workspaceId)}
                className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    !isWorkspaceCollapsed && "rotate-90",
                  )}
                />
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onSelectWorkspaceHeader(workspace.workspaceId)}
                className={cn(
                  "min-w-0 flex-1 truncate text-left text-xs font-bold text-muted-foreground hover:text-foreground",
                  workspace.active && "text-foreground",
                )}
              >
                {workspace.label}
              </button>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                {totalTabs}
              </span>
            </div>
            {!isWorkspaceCollapsed && (
              <div className="flex flex-col gap-1 px-1.5 pb-1.5">
                {workspace.tiles.map((tile) => {
                  if (!showTileHeaders) {
                    return (
                      <Fragment key={tile.tileId}>
                        {tile.tabs.map((tab) =>
                          renderTabCard(workspace.workspaceId, tile.tileId, tab),
                        )}
                      </Fragment>
                    );
                  }
                  const isTileCollapsed = collapsedTiles.has(tile.tileId);
                  return (
                    <div key={tile.tileId}>
                      <div className="flex w-full items-center gap-1 py-1">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => toggleCollapsedTile(tile.tileId)}
                          className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <ChevronRight
                            className={cn(
                              "size-2.5 transition-transform",
                              !isTileCollapsed && "rotate-90",
                            )}
                          />
                        </button>
                        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-muted-foreground">
                          {tile.label}
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-1 py-0.5 text-[8px] font-medium text-muted-foreground/80">
                          {tile.tabs.length}
                        </span>
                      </div>
                      {!isTileCollapsed && (
                        <div className="flex flex-col gap-1 pl-2">
                          {tile.tabs.map((tab) =>
                            renderTabCard(workspace.workspaceId, tile.tileId, tab),
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
