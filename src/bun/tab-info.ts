// `niwa tab show`が返す、1つのタブの所在（ワークスペース・Board・タイル）とそれぞれの名前を組み立てる。

import { listLeaves, type TabId } from "./tile-layout";
import type { WorkspaceListEntry } from "./workspace-manager";

export interface TabInfoItem {
  id: string;
  /** 未設定はnull。Boardは自動名（board.naming）へフォールバックする */
  name: string | null;
}

export interface TabInfo {
  workspace: TabInfoItem;
  /** Boardが1つも無いワークスペースのポップアップではnull */
  board: TabInfoItem | null;
  /** ポップアップのタブはタイル階層に居ないためnull */
  tile: TabInfoItem | null;
  tab: TabInfoItem;
}

/** tabIdの所在を引く。見つからなければnull */
export function describeTab(workspaces: WorkspaceListEntry[], tabId: TabId): TabInfo | null {
  for (const ws of workspaces) {
    const workspace = { id: ws.workspaceId, name: ws.name };
    for (const board of ws.boards) {
      const leaf = listLeaves(board.layout).find((l) => l.tabIds.includes(tabId));
      if (!leaf) continue;
      return {
        workspace,
        board: { id: board.boardId, name: board.name ?? board.autoName },
        tile: { id: leaf.id, name: board.tileNames[leaf.id] ?? null },
        tab: { id: tabId, name: board.tabNames[tabId] ?? null },
      };
    }
    // ポップアップはBoardをまたいで共有される（ADR 0006）ので、今表示しているBoardを所属とみなす。
    // --board等を省略したコマンドをポップアップから叩いた時の対象と揃う
    if (ws.popup?.tabId === tabId) {
      const board = ws.boards.find((b) => b.boardId === ws.activeBoardId);
      return {
        workspace,
        board: board ? { id: board.boardId, name: board.name ?? board.autoName } : null,
        tile: null,
        tab: { id: tabId, name: null },
      };
    }
  }
  return null;
}
