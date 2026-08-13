import { listLeaves, type TabId, type TileId } from "../../bun/tile-layout";
import type { WorkspaceId, WorkspaceListEntry } from "../../bun/workspace-manager";

export type AgentStatus = "idle" | "working" | "blocked";

const KNOWN_AGENT_STATUSES: readonly AgentStatus[] = ["idle", "working", "blocked"];

export interface SidebarTabAgentInfo {
  agent: string;
  status: AgentStatus;
  statusText: string | null;
}

export interface SidebarTabRowItem {
  tabId: TabId;
  label: string;
  active: boolean;
  branch: string | null;
  agent: SidebarTabAgentInfo | null;
}

export interface SidebarTileItem {
  tileId: TileId;
  label: string;
  tabs: SidebarTabRowItem[];
}

export interface SidebarWorkspaceItem {
  workspaceId: WorkspaceId;
  label: string;
  active: boolean;
  tiles: SidebarTileItem[];
}

/** 未知の値・未設定はidleへフォールバックする（表示側で例外を出さないための安全側デフォルト） */
function normalizeAgentStatus(raw: string | undefined): AgentStatus {
  return (KNOWN_AGENT_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as AgentStatus)
    : "idle";
}

/** working/blocked状態のバッジラベル。idleは特筆すべき状態ではないためバッジを出さずnullを返す */
export function agentStatusBadgeLabel(status: AgentStatus): string | null {
  switch (status) {
    case "working":
      return "作業中";
    case "blocked":
      return "応答待ち";
    case "idle":
      return null;
  }
}

/** working/blocked状態のバッジ配色Tailwindクラスを返す。idleはバッジ自体を出さないため空文字列 */
export function agentStatusBadgeClass(status: AgentStatus): string {
  switch (status) {
    case "working":
      return "text-blue-500 bg-blue-500/15";
    case "blocked":
      return "text-amber-500 bg-amber-500/15";
    case "idle":
      return "";
  }
}

/**
 * renderSidebar()旧実装のラベル整形・active判定ロジックを、DOM非依存の純粋関数として抽出したもの。
 * サイドバーは全ワークスペースをフラットに列挙する（アクティブワークスペースのみのタイル木とは別）。
 * タブラベルはタイル内の連番のみ（"Tile x / "は表示側でタイル見出しとして扱うため含めない）。
 */
export function buildSidebarWorkspaceItems(
  workspaces: WorkspaceListEntry[],
  currentActiveWorkspaceId: WorkspaceId | null,
): SidebarWorkspaceItem[] {
  return workspaces.map((entry, workspaceIndex) => ({
    workspaceId: entry.workspaceId,
    label: `Workspace ${workspaceIndex + 1}`,
    active: entry.workspaceId === currentActiveWorkspaceId,
    tiles: listLeaves(entry.layout).map((leaf, tileIndex) => ({
      tileId: leaf.id,
      label: entry.tileNames[leaf.id] || `Tile ${tileIndex + 1}`,
      tabs: leaf.tabIds.map((tabId, tabIndex) => {
        const vars = entry.tabVars[tabId];
        const branch = vars?.["branch"] || null;
        const agentName = vars?.["agent"] || null;
        const agent: SidebarTabAgentInfo | null = agentName
          ? {
              agent: agentName,
              status: normalizeAgentStatus(vars?.["agent_status"]),
              statusText: vars?.["agent_status_text"] || null,
            }
          : null;
        return {
          tabId,
          label: entry.tabNames[tabId] || `Tab ${tabIndex + 1}`,
          active: entry.workspaceId === currentActiveWorkspaceId && tabId === leaf.activeTabId,
          branch,
          agent,
        };
      }),
    })),
  }));
}
