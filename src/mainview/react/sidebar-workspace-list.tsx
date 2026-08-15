import { Bot, ChevronRight, GitBranch, PictureInPicture2 } from "lucide-react";
import { Fragment, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { TabId, TileId } from "../../bun/tile-layout";
import type { WorkspaceId } from "../../bun/workspace-manager";
import {
  agentStatusBadgeClass,
  agentStatusBadgeLabel,
  type SidebarPopupItem,
  type SidebarTabRowItem,
  type SidebarWorkspaceItem,
} from "./sidebar-props";

export interface SidebarWorkspaceListProps {
  workspaces: SidebarWorkspaceItem[];
  onSelectWorkspaceHeader: (workspaceId: WorkspaceId) => void;
  onSelectTab: (workspaceId: WorkspaceId, tileId: TileId, tabId: TabId) => void;
  onSelectPopup: (workspaceId: WorkspaceId) => void;
  onRenameTab: (tabId: TabId, name: string) => void;
  onRenameTile: (tileId: TileId, name: string) => void;
  onRenameWorkspace: (workspaceId: WorkspaceId, name: string) => void;
}

const COLLAPSED_WORKSPACES_STORAGE_KEY = "niwaterm:sidebarCollapsedWorkspaces";
const COLLAPSED_TILES_STORAGE_KEY = "niwaterm:sidebarCollapsedTiles";

type EditingTarget =
  | { kind: "tab"; id: TabId }
  | { kind: "tile"; id: TileId }
  | { kind: "workspace"; id: WorkspaceId };

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
  onSelectPopup,
  onRenameTab,
  onRenameTile,
  onRenameWorkspace,
}: SidebarWorkspaceListProps) {
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<WorkspaceId>>(() =>
    loadCollapsedIds(COLLAPSED_WORKSPACES_STORAGE_KEY),
  );
  const [collapsedTiles, setCollapsedTiles] = useState<Set<TileId>>(() =>
    loadCollapsedIds(COLLAPSED_TILES_STORAGE_KEY),
  );
  // 名前編集中のタブ/タイル。確定はEnterのみ、Escapeまたはフォーカス喪失時は変更を破棄する
  const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null);
  const [editingValue, setEditingValue] = useState("");

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

  function startEditing(target: EditingTarget, currentLabel: string): void {
    setEditingTarget(target);
    setEditingValue(currentLabel);
  }

  function commitEditing(): void {
    if (!editingTarget) return;
    if (editingTarget.kind === "tab") {
      onRenameTab(editingTarget.id, editingValue);
    } else if (editingTarget.kind === "tile") {
      onRenameTile(editingTarget.id, editingValue);
    } else {
      onRenameWorkspace(editingTarget.id, editingValue);
    }
    setEditingTarget(null);
  }

  function cancelEditing(): void {
    setEditingTarget(null);
  }

  function renderNameInput() {
    return (
      <input
        type="text"
        autoFocus
        value={editingValue}
        onChange={(e) => setEditingValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={cancelEditing}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commitEditing();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelEditing();
          }
        }}
        className="w-full min-w-0 rounded border border-ring bg-background px-1 py-0.5 text-xs text-foreground outline-none"
      />
    );
  }

  function renderTabCard(workspaceId: WorkspaceId, tileId: TileId, tab: SidebarTabRowItem) {
    if (editingTarget?.kind === "tab" && editingTarget.id === tab.tabId) {
      return (
        <div key={tab.tabId} className="px-1.5 py-1">
          {renderNameInput()}
        </div>
      );
    }
    const badgeLabel = tab.agent ? agentStatusBadgeLabel(tab.agent.status) : null;
    return (
      <ContextMenu key={tab.tabId}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onSelectTab(workspaceId, tileId, tab.tabId)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing({ kind: "tab", id: tab.tabId }, tab.label);
            }}
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
            {tab.branch && (
              <div className="flex items-center gap-1 pl-5 text-[10px] text-muted-foreground/70">
                <GitBranch className="size-2.5 shrink-0" />
                <span className="min-w-0 truncate">{tab.branch}</span>
              </div>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => startEditing({ kind: "tab", id: tab.tabId }, tab.label)}>
            名前を変更
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  /**
   * ポップアップ（ADR 0005）はTile木構造の外側にあるためrenderTabCardと違いtileIdを持たない。
   * 最小化（非表示）中でもサイドバーから存在を把握・再表示できるようにする
   */
  function renderPopupCard(workspaceId: WorkspaceId, popup: SidebarPopupItem) {
    return (
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onSelectPopup(workspaceId)}
        title={popup.visible ? undefined : "最小化中のポップアップ（クリックで再表示）"}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent"
      >
        <PictureInPicture2 className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{popup.label}</span>
        {!popup.visible && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
            最小化
          </span>
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
        const isEditingThisWorkspace =
          editingTarget?.kind === "workspace" && editingTarget.id === workspace.workspaceId;
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
              {isEditingThisWorkspace ? (
                <div className="min-w-0 flex-1">{renderNameInput()}</div>
              ) : (
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onSelectWorkspaceHeader(workspace.workspaceId)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditing(
                          { kind: "workspace", id: workspace.workspaceId },
                          workspace.label,
                        );
                      }}
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-xs font-bold text-muted-foreground hover:text-foreground",
                        workspace.active && "text-foreground",
                      )}
                    >
                      {workspace.label}
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() =>
                        startEditing(
                          { kind: "workspace", id: workspace.workspaceId },
                          workspace.label,
                        )
                      }
                    >
                      名前を変更
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )}
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                {totalTabs}
              </span>
            </div>
            {!isWorkspaceCollapsed && (
              <div className="flex flex-col gap-1 px-1.5 pb-1.5">
                {workspace.popup && renderPopupCard(workspace.workspaceId, workspace.popup)}
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
                  const isEditingThisTile =
                    editingTarget?.kind === "tile" && editingTarget.id === tile.tileId;
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
                        {isEditingThisTile ? (
                          renderNameInput()
                        ) : (
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <span
                                className="min-w-0 flex-1 truncate text-[10px] font-semibold text-muted-foreground"
                                onDoubleClick={() =>
                                  startEditing({ kind: "tile", id: tile.tileId }, tile.label)
                                }
                              >
                                {tile.label}
                              </span>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem
                                onSelect={() =>
                                  startEditing({ kind: "tile", id: tile.tileId }, tile.label)
                                }
                              >
                                名前を変更
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        )}
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
