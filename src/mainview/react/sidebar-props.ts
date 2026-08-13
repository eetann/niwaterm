import { listLeaves, type TabId, type TileId } from "../../bun/tile-layout";
import type { WorkspaceId, WorkspaceListEntry } from "../../bun/workspace-manager";

export type AgentStatus = "idle" | "working" | "blocked";

const KNOWN_AGENT_STATUSES: readonly AgentStatus[] = ["idle", "working", "blocked"];

export interface SidebarTabAgentInfo {
  agent: string;
  status: AgentStatus;
}

export interface SidebarTabRowItem {
  tabId: TabId;
  tileId: TileId;
  label: string;
  active: boolean;
  branch: string | null;
  agent: SidebarTabAgentInfo | null;
}

export interface SidebarWorkspaceItem {
  workspaceId: WorkspaceId;
  label: string;
  active: boolean;
  tabs: SidebarTabRowItem[];
}

/** 未知の値・未設定はidleへフォールバックする（表示側で例外を出さないための安全側デフォルト） */
function normalizeAgentStatus(raw: string | undefined): AgentStatus {
  return (KNOWN_AGENT_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as AgentStatus)
    : "idle";
}

/** idle/working/blockedの状態を表す色分けドットのTailwindクラスを返す */
export function agentStatusDotClass(status: AgentStatus): string {
  switch (status) {
    case "working":
      return "bg-blue-500";
    case "blocked":
      return "bg-amber-500";
    case "idle":
      return "bg-emerald-500";
  }
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
      const vars = entry.tileVars[leaf.id];
      const branch = vars?.["branch"] || null;
      const agentName = vars?.["agent"] || null;
      const agent: SidebarTabAgentInfo | null = agentName
        ? { agent: agentName, status: normalizeAgentStatus(vars?.["agent_status"]) }
        : null;
      return leaf.tabIds.map((tabId, tabIndex) => ({
        tabId,
        tileId: leaf.id,
        label: `Tile ${tileIndex + 1} / Tab ${tabIndex + 1}`,
        active: entry.workspaceId === currentActiveWorkspaceId && tabId === leaf.activeTabId,
        branch,
        agent,
      }));
    }),
  }));
}
