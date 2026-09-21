// ワークツリーとBoardの対応づけ。
//
// 判定キーはBoardを開いたときに記録したworktreePathで、タブのcwdは見ない（cdで変わるため）。
// Board名を変えても紐づけは切れず、別リポジトリの同名ブランチと取り違えることもない。

import { type IpcEndpoint, listWorkspaces } from "../ipc-client";

export interface WorktreeBoard {
  boardId: string;
  workspaceId: string;
  /** そのBoardが属するワークスペースが今アクティブかどうか */
  workspaceActive: boolean;
}

export type FindWorktreeBoardsResult =
  | { ok: true; boards: WorktreeBoard[] }
  | { ok: false; error: string };

/**
 * そのワークツリーのパスで開かれたBoardを全ワークスペースから探す。
 * pathはtoAppAccessiblePath()を通した後の、アプリ側が持つ表記であること
 */
export async function findWorktreeBoards(
  endpoint: IpcEndpoint,
  appPath: string,
): Promise<FindWorktreeBoardsResult> {
  const list = await listWorkspaces(endpoint);
  if (!list.ok) return { ok: false, error: list.error };
  const boards: WorktreeBoard[] = [];
  for (const workspace of list.workspaces) {
    for (const board of workspace.boards) {
      if (board.worktreePath !== appPath) continue;
      boards.push({
        boardId: board.boardId,
        workspaceId: workspace.workspaceId,
        workspaceActive: workspace.active,
      });
    }
  }
  return { ok: true, boards };
}
