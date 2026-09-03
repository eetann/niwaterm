import { findNode, listLeaves, type TabId } from "../../bun/tile-layout";
import type { BoardId, BoardListEntry } from "../../bun/workspace";
import type { WorkspaceId, WorkspaceListEntry } from "../../bun/workspace-manager";

export type AgentStatus = "idle" | "working" | "blocked";

const KNOWN_AGENT_STATUSES: readonly AgentStatus[] = ["idle", "working", "blocked"];

export interface SidebarBoardAgentInfo {
  agent: string;
  status: AgentStatus;
  statusText: string | null;
}

export interface SidebarBoardItem {
  boardId: BoardId;
  label: string;
  active: boolean;
  branch: string | null;
  agent: SidebarBoardAgentInfo | null;
  /** フォーカス中タイルがズーム表示中か（toggle-zoom）。Board内のどのタイルかは問わず、見た目上は1行のBoardが対象 */
  zoomed: boolean;
}

export interface SidebarPopupItem {
  tabId: TabId;
  visible: boolean;
  label: string;
}

export interface SidebarWorkspaceItem {
  workspaceId: WorkspaceId;
  label: string;
  active: boolean;
  boards: SidebarBoardItem[];
  popup: SidebarPopupItem | null;
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
 * Boardの状態表示（変数・ステータスライン）に使う代表タブ。フォーカス中タイルのアクティブタブを使う
 * （ユーザーが今そのBoardで見ているタブの状態が、サイドバーの一覧でも最も自然に対応するため）。
 * フォーカス中タイルが見つからない・leafでない場合は代表タブなしとして扱う
 */
function findRepresentativeTabId(board: BoardListEntry): TabId | null {
  const node = findNode(board.layout, board.focusedTileId);
  return node && node.kind === "leaf" ? node.activeTabId : null;
}

/** 目立つ状態ほど大きい。同一Board内に複数エージェントがいる場合の採用順に使う */
const AGENT_STATUS_PRIORITY: Record<AgentStatus, number> = {
  blocked: 2,
  working: 1,
  idle: 0,
};

function toAgentInfo(vars: Record<string, string> | undefined): SidebarBoardAgentInfo | null {
  const agentName = vars?.["agent"] || null;
  if (!agentName) return null;
  return {
    agent: agentName,
    status: normalizeAgentStatus(vars?.["agent_status"]),
    statusText: vars?.["agent_status_text"] || null,
  };
}

/**
 * Board行に出すエージェント状態。Board内の全タブ（全タイル・非アクティブタブを含む）を走査し、
 * blocked > working > idle の順で最も目立つものを1つ選ぶ。
 * Board行は1行という設計（ADR 0006後の再設計）を保ったまま、フォーカスしていないタイル・タブで
 * 動くエージェントの「応答待ち」を取りこぼさないようにするため
 * （Board階層の導入前はタブごとに行があり、全エージェントの状態が個別に見えていた）。
 * 同順位なら代表タブを優先し、それも無ければレイアウト上の出現順で先勝ちにする（表示のちらつき防止）。
 */
function findBoardAgent(
  board: BoardListEntry,
  representativeTabId: TabId | null,
): SidebarBoardAgentInfo | null {
  let best: SidebarBoardAgentInfo | null = null;
  let bestPriority = -1;
  for (const leaf of listLeaves(board.layout)) {
    for (const tabId of leaf.tabIds) {
      const agent = toAgentInfo(board.tabVars[tabId]);
      if (!agent) continue;
      const priority = AGENT_STATUS_PRIORITY[agent.status];
      // 同順位で代表タブが後から出てきた場合のみ入れ替える（それ以外の同順位は先勝ち）
      if (priority > bestPriority || (priority === bestPriority && tabId === representativeTabId)) {
        best = agent;
        bestPriority = priority;
      }
    }
  }
  return best;
}

/**
 * renderSidebar()旧実装のラベル整形・active判定ロジックを、DOM非依存の純粋関数として抽出したもの。
 * サイドバーは全ワークスペースをフラットに列挙する（アクティブワークスペースのみのタイル木とは別）。
 * Tile/Tabはサイドバーに表示しない（ADR 0006後の再設計。「1つのBoard=1つの独立した作業」という
 * 単位で捉え、Tile分割はBoard内部の詳細として畳む）。ブランチ・エージェント状態はタブ変数を
 * Boardの状態表示として流用し、Board専用の変数ストアは新設しない
 * （ブランチは代表タブのみ、エージェント状態はBoard内の全タブから選ぶ。findBoardAgent参照）。
 * ポップアップはWorkspace直下の状態（ADR 0005・ADR 0006）でBoardをまたいでも共有されるため、
 * entry.popupを直接参照する（専用のリネームUIも無いためラベルは固定文言）
 */
export function buildSidebarWorkspaceItems(
  workspaces: WorkspaceListEntry[],
  currentActiveWorkspaceId: WorkspaceId | null,
): SidebarWorkspaceItem[] {
  return workspaces.map((entry, workspaceIndex) => ({
    workspaceId: entry.workspaceId,
    label: entry.name || `Workspace ${workspaceIndex + 1}`,
    active: entry.workspaceId === currentActiveWorkspaceId,
    popup: entry.popup
      ? {
          tabId: entry.popup.tabId,
          visible: entry.popup.visible,
          label: "Popup",
        }
      : null,
    boards: entry.boards.map((board, boardIndex) => {
      const representativeTabId = findRepresentativeTabId(board);
      const vars = representativeTabId ? board.tabVars[representativeTabId] : undefined;
      // branchは「今そのBoardで見ているタブ」の値が自然なので代表タブのみを見る。
      // エージェント状態はBoard内の全タブから拾う（findBoardAgentのコメント参照）
      const branch = vars?.["branch"] || null;
      const agent = findBoardAgent(board, representativeTabId);
      return {
        boardId: board.boardId,
        label: board.name || `Board ${boardIndex + 1}`,
        active: entry.workspaceId === currentActiveWorkspaceId && board.active,
        branch,
        agent,
        zoomed: board.zoomedTileId !== null,
      };
    }),
  }));
}
