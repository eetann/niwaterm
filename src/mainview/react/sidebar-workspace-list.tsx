import { AlertTriangle, ChevronRight, Maximize2, PictureInPicture2 } from "lucide-react";
import { useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { BoardId } from "../../bun/workspace";
import type { WorkspaceId } from "../../bun/workspace-manager";
import type { SidebarBoardItem, SidebarPopupItem, SidebarWorkspaceItem } from "./sidebar-props";

export interface SidebarWorkspaceListProps {
  workspaces: SidebarWorkspaceItem[];
  onSelectWorkspaceHeader: (workspaceId: WorkspaceId) => void;
  onSelectBoard: (workspaceId: WorkspaceId, boardId: BoardId) => void;
  onSelectPopup: (workspaceId: WorkspaceId) => void;
  onRenameBoard: (boardId: BoardId, name: string) => void;
  onRenameWorkspace: (workspaceId: WorkspaceId, name: string) => void;
}

const COLLAPSED_WORKSPACES_STORAGE_KEY = "niwaterm:sidebarCollapsedWorkspaces";

type EditingTarget = { kind: "board"; id: BoardId } | { kind: "workspace"; id: WorkspaceId };

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
  onSelectBoard,
  onSelectPopup,
  onRenameBoard,
  onRenameWorkspace,
}: SidebarWorkspaceListProps) {
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<WorkspaceId>>(() =>
    loadCollapsedIds(COLLAPSED_WORKSPACES_STORAGE_KEY),
  );
  // 名前編集中のBoard/Workspace。確定はEnterのみ、Escapeまたはフォーカス喪失時は変更を破棄する
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

  function startEditing(target: EditingTarget, currentLabel: string): void {
    setEditingTarget(target);
    setEditingValue(currentLabel);
  }

  function commitEditing(): void {
    if (!editingTarget) return;
    if (editingTarget.kind === "board") {
      onRenameBoard(editingTarget.id, editingValue);
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

  /**
   * Board行はTile/Tabを表示しない1行が既定（ADR 0006後の再設計）。ブランチ・エージェント状態が
   * 何も無ければ展開せず1行のまま終わる。何かあれば縦線ガイド付きでステータスラインを展開する
   * （Neovimのwinbar・Claude Codeのステータスライン相当。等幅フォントで「on <branch>」
   * 「❯/⚠ <statusText>」を表示する）
   */
  function renderBoardRow(workspaceId: WorkspaceId, board: SidebarBoardItem) {
    if (editingTarget?.kind === "board" && editingTarget.id === board.boardId) {
      return (
        <div key={board.boardId} className="px-1.5 py-1">
          {renderNameInput()}
        </div>
      );
    }
    const hasStatusLine = board.branch !== null || board.agent !== null;
    const dotClass =
      board.agent?.status === "working"
        ? "bg-blue-500 shadow-[0_0_4px] shadow-blue-500"
        : board.agent?.status === "blocked"
          ? "bg-amber-500 shadow-[0_0_4px] shadow-amber-500"
          : "bg-muted-foreground/30";
    const titleParts: string[] = [];
    if (board.zoomed) titleParts.push("ズーム中");
    if (board.agent) titleParts.push(`${board.agent.agent}: ${board.agent.status}`);
    return (
      <ContextMenu key={board.boardId}>
        <ContextMenuTrigger asChild>
          <div
            className={cn("flex flex-col rounded-md", board.active && "bg-accent")}
            title={titleParts.length > 0 ? titleParts.join(" / ") : undefined}
          >
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onSelectBoard(workspaceId, board.boardId)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEditing({ kind: "board", id: board.boardId }, board.label);
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent"
            >
              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dotClass)} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{board.label}</span>
              {board.zoomed && (
                <Maximize2
                  aria-label="ズーム中"
                  className="size-3 shrink-0 text-muted-foreground"
                />
              )}
            </button>
            {hasStatusLine && (
              <div className="flex gap-1.5 px-1.5 pb-1.5">
                <div className="ml-[3px] w-0.5 shrink-0 rounded-full bg-muted-foreground/20" />
                <div className="min-w-0 flex-1 font-mono text-[10px] leading-relaxed">
                  {board.branch && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="text-blue-400/80">on</span>
                      <span className="min-w-0 truncate">{board.branch}</span>
                    </div>
                  )}
                  {board.agent?.statusText && (
                    <div className="flex gap-1.5">
                      {board.agent.status === "blocked" ? (
                        <AlertTriangle className="mt-0.5 size-2.5 shrink-0 text-amber-500" />
                      ) : (
                        <span className="text-sky-400">❯</span>
                      )}
                      <span
                        className={cn(
                          "line-clamp-2",
                          board.agent.status === "blocked"
                            ? "text-amber-400/90"
                            : "text-muted-foreground",
                        )}
                      >
                        {board.agent.statusText}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => startEditing({ kind: "board", id: board.boardId }, board.label)}
          >
            名前を変更
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  /**
   * ポップアップ（ADR 0005）はTile/Board木構造の外側にある一時的な状態。BoardカードとはUI上でも
   * 明確に区別するため、破線の枠＋影で意図的に「浮いている」見た目にする
   */
  function renderPopupCard(workspaceId: WorkspaceId, popup: SidebarPopupItem) {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 px-1">
          <div className="h-px flex-1 bg-border" />
          <span className="shrink-0 text-[8px] font-bold tracking-wider text-muted-foreground/70">
            POPUP
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onSelectPopup(workspaceId)}
          title={popup.visible ? undefined : "最小化中のポップアップ（クリックで再表示）"}
          className="flex items-center gap-1.5 rounded-xl border border-dashed border-muted-foreground/30 bg-accent/40 px-2.5 py-1.5 text-left shadow-md hover:bg-accent"
        >
          <PictureInPicture2 className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{popup.label}</span>
          <span className="shrink-0 text-[9px] text-muted-foreground">
            {popup.visible ? "popup" : "最小化"}
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
      {workspaces.map((workspace) => {
        const isWorkspaceCollapsed = collapsedWorkspaces.has(workspace.workspaceId);
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
                {workspace.boards.length}
              </span>
            </div>
            {!isWorkspaceCollapsed && (
              <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
                {workspace.boards.map((board) => renderBoardRow(workspace.workspaceId, board))}
                {workspace.popup && renderPopupCard(workspace.workspaceId, workspace.popup)}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
