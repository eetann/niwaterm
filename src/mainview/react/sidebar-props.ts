import { type ResolvedBoardPhase, resolveBoardPhase } from "@niwaterm/config";
import type { BoardRestoreMode } from "../../bun/persistence";
import { findNode, listLeaves, type TabId } from "../../bun/tile-layout";
import type { BoardId } from "../../bun/workspace";
import type {
  BoardStatusEntry,
  WorkspaceId,
  WorkspaceListEntry,
} from "../../bun/workspace-manager";

export type AgentStatus = "idle" | "working" | "blocked";

const KNOWN_AGENT_STATUSES: readonly AgentStatus[] = ["idle", "working", "blocked"];

export interface SidebarBoardAgentInfo {
  agent: string;
  status: AgentStatus;
  statusText: string | null;
}

export interface SidebarBoardStartupInfo {
  preset: string;
  restoreMode: BoardRestoreMode;
  /** プロジェクトローカル由来ならそのルート。グローバル設定由来ならnull（trust確認の要否判定に使う） */
  projectRoot: string | null;
}

export interface SidebarBoardItem {
  boardId: BoardId;
  label: string;
  active: boolean;
  branch: string | null;
  agent: SidebarBoardAgentInfo | null;
  /** フォーカス中タイルがズーム表示中か（toggle-zoom）。Board内のどのタイルかは問わず、見た目上は1行のBoardが対象 */
  zoomed: boolean;
  /** Board内のいずれかのタブでベルが鳴ったまま未読か */
  bell: boolean;
  /** 紐づくレイアウトプリセットと起動時の組み直し方。未設定はnull */
  startup: SidebarBoardStartupInfo | null;
  /** 紐づくgitワークツリーの絶対パス。未設定はnull */
  worktreePath: string | null;
  /** 紐づけ先のディレクトリが見つからないか（紐づけが無いBoardは常にfalse） */
  worktreeMissing: boolean;
  /** ユーザーが付けた作業フェーズ。未設定はnull */
  phase: SidebarBoardPhaseItem | null;
}

/** Board行に出す作業フェーズのバッジ。候補に無い文字列はlabel=値そのもの・color=nullで出る */
export interface SidebarBoardPhaseItem {
  /** Boardに保存されている値（board.phasesのidか任意の文字列） */
  value: string;
  label: string;
  /** 候補で指定された配色。未指定はnull（表示側の既定色） */
  color: string | null;
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

/** ドラッグ中の行を、ドロップ先の行の手前へ入れるか後ろへ入れるか */
export type SidebarDropPosition = "before" | "after";

/**
 * サイドバーのD&Dによる並び替えの移動先index（0始まり、bun側のmoveWorkspace/moveBoardへ渡す値）。
 * overIndexの手前/後ろへ挿入した結果の位置を、ドラッグ元を取り除いた後のindexとして返す。
 * 並びが変わらない組み合わせ（自分自身の手前・後ろへのドロップ）はnull。
 * ワークスペースの並びとワークスペース内のBoardの並びで同じ計算を使う
 */
export function sidebarDropIndex(
  fromIndex: number,
  overIndex: number,
  position: SidebarDropPosition,
): number | null {
  const insertAt = position === "before" ? overIndex : overIndex + 1;
  const toIndex = insertAt > fromIndex ? insertAt - 1 : insertAt;
  return toIndex === fromIndex ? null : toIndex;
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
function findRepresentativeTabId(board: BoardStatusEntry): TabId | null {
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
 * Board行は1行という設計（ADR 0006）を保ったまま、フォーカスしていないタイル・タブで
 * 動くエージェントの「応答待ち」を取りこぼさないようにするため。
 * 同順位なら代表タブを優先し、それも無ければレイアウト上の出現順で先勝ちにする（表示のちらつき防止）。
 */
function findBoardAgent(
  board: BoardStatusEntry,
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
 * Board内のいずれかのタブでベルが鳴ったまま未読か。エージェント状態と同じく、フォーカスしていない
 * タイル・非アクティブタブで鳴ったベルも取りこぼさないよう全タブを見る
 */
function hasUnreadBell(board: BoardStatusEntry): boolean {
  return listLeaves(board.layout).some((leaf) =>
    leaf.tabIds.some((tabId) => Boolean(board.tabVars[tabId]?.["bell"])),
  );
}

/**
 * Board行の表示名。ユーザーが名前を設定していなければ設定（board.naming）による自動名を出す。
 * 自動名すら付けられなかった場合（cwdが分からない等）だけワークスペース内の並び順で連番にする。
 * サイドバー以外（キーバインド・コマンドパレット起点の名前変更ダイアログ）でも同じラベルを出すためexportする
 */
export function boardLabel(board: BoardStatusEntry, index: number): string {
  return board.name || board.autoName || `Board ${index + 1}`;
}

/**
 * ワークスペース行の表示名。boardLabelと同じく、名前未設定なら表示順の連番へフォールバックする。
 * サイドバー以外（移動先ワークスペースのピッカー・確認ダイアログ）でも同じラベルを出すためexportする
 */
export function workspaceLabel(workspace: WorkspaceListEntry, index: number): string {
  return workspace.name || `Workspace ${index + 1}`;
}

/**
 * Boardに保存された文字列を表示用のバッジ情報へ変換する。設定から候補が消えても
 * （あるいは最初からCLIで任意の文字列を入れても）、値そのものをラベルとして出す
 */
function toPhaseItem(
  boardPhases: readonly ResolvedBoardPhase[],
  value: string,
): SidebarBoardPhaseItem {
  const resolved = resolveBoardPhase(boardPhases, value);
  return { value, label: resolved.label, color: resolved.color };
}

/**
 * サイドバーへ渡すワークスペース一覧を、ラベル整形とactive判定まで済ませた形で組み立てる（DOM非依存）。
 * サイドバーは全ワークスペースをフラットに列挙する（アクティブワークスペースのみのタイル木とは別）。
 * Tile/Tabはサイドバーに表示しない（ADR 0006。「1つのBoard=1つの独立した作業」という
 * 単位で捉え、Tile分割はBoard内部の詳細として畳む）。ブランチ・エージェント状態はタブ変数を
 * Boardの状態表示として流用し、Board専用の変数ストアは新設しない
 * （ブランチは代表タブのみ、エージェント状態はBoard内の全タブから選ぶ。findBoardAgent参照）。
 * ポップアップはWorkspace直下の状態（ADR 0005・ADR 0006）でBoardをまたいでも共有されるため、
 * entry.popupを直接参照する（専用のリネームUIも無いためラベルは固定文言）
 */
export function buildSidebarWorkspaceItems(
  workspaces: WorkspaceListEntry[],
  currentActiveWorkspaceId: WorkspaceId | null,
  boardPhases: readonly ResolvedBoardPhase[] = [],
): SidebarWorkspaceItem[] {
  return workspaces.map((entry, workspaceIndex) => ({
    workspaceId: entry.workspaceId,
    label: workspaceLabel(entry, workspaceIndex),
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
        label: boardLabel(board, boardIndex),
        active: entry.workspaceId === currentActiveWorkspaceId && board.active,
        branch,
        agent,
        zoomed: board.zoomedTileId !== null,
        bell: hasUnreadBell(board),
        startup: board.startup
          ? {
              preset: board.startup.preset,
              restoreMode: board.startup.restoreMode,
              projectRoot: board.startup.projectRoot ?? null,
            }
          : null,
        worktreePath: board.worktreePath,
        worktreeMissing: board.worktreeMissing,
        phase: board.phase === null ? null : toPhaseItem(boardPhases, board.phase),
      };
    }),
  }));
}
