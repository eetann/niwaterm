import { failAndExit } from "../cli-error";
import {
  type IpcEndpoint,
  listWorkspaces,
  newBoard,
  renameBoard,
  sendKeys,
  switchBoard,
  switchWorkspace,
  toAppAccessiblePath,
} from "../ipc-client";
import { createTargetResolver } from "../resolve-target";
import type { WorktreeOpenMode } from "./config";

/**
 * `cd`へ渡すパスを引用する。POSIXシェルもPowerShellもシングルクォート文字列を解釈するため`'`で包む。
 * 内部の`'`の閉じ直し方はPOSIX式（`'\''`）で、`'`を含むパスをPowerShellのタブへ送ると崩れるが、
 * 引用せずに空白入りパスを送るほうが壊れる範囲が広いのでこちらを採る
 */
function shellQuotePath(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

interface FoundBoard {
  boardId: string;
  workspaceId: string;
  /** そのBoardが属するワークスペースが今アクティブかどうか */
  workspaceActive: boolean;
}

/**
 * そのワークツリーのBoardが既に開いていないか探す。Board作成時に記録したworktreePathが判定キーで、
 * タブのcwdは見ない（cdで変わるため）。同じパスのBoardが複数ある場合は最初の1つを返す
 */
async function findOpenBoard(endpoint: IpcEndpoint, appPath: string): Promise<FoundBoard | null> {
  const list = await listWorkspaces(endpoint);
  if (!list.ok) return null;
  for (const workspace of list.workspaces) {
    for (const board of workspace.boards) {
      if (board.worktreePath === appPath) {
        return {
          boardId: board.boardId,
          workspaceId: workspace.workspaceId,
          workspaceActive: workspace.active,
        };
      }
    }
  }
  return null;
}

export interface OpenWorktreeOptions {
  endpoint: IpcEndpoint;
  /** エラー文言に使うフルコマンド名（"worktree new" / "worktree open"） */
  commandName: string;
  mode: WorktreeOpenMode;
  /** 開くワークツリーの絶対パス */
  path: string;
  /** Board名に使うブランチ名。detached HEADのワークツリーはnull */
  branch: string | null;
  /** Boardの作成先。省略時はアクティブなワークスペース */
  workspaceId?: string;
}

/**
 * ワークツリーをniwatermで開く。`worktree new`と`worktree open`で共有する。
 * board系のモードでは既にそのワークツリーのBoardがあればそれを使い回し、同じワークツリーの
 * Boardが増えないようにする
 */
export async function openWorktree(opts: OpenWorktreeOptions): Promise<void> {
  const { endpoint, commandName, mode, path, branch } = opts;
  if (mode === "none") return;

  if (mode === "current-tab") {
    const target = createTargetResolver(endpoint, commandName, {});
    // シェルは実行中のこのCLIが終わるまで入力を読まないため、キーはtty側で待たされてから流れる
    const result = await sendKeys(endpoint, await target.tabId(), [
      `cd ${shellQuotePath(path)}`,
      "Enter",
    ]);
    if (!result.ok) failAndExit(`${commandName}に失敗しました: ${result.error}`);
    return;
  }

  const appPath = toAppAccessiblePath(endpoint, path);
  const found = await findOpenBoard(endpoint, appPath);
  if (found) {
    if (opts.workspaceId !== undefined && opts.workspaceId !== found.workspaceId) {
      console.error("warning: 既に開いているBoardを使うため--workspaceは使われません");
    }
    if (mode === "board-switch") {
      // switchBoardは所属ワークスペース内のアクティブBoardを変えるだけなので、
      // 別ワークスペースのBoardは先にワークスペースごと切り替えないと画面に出ない
      if (!found.workspaceActive) {
        const switched = await switchWorkspace(endpoint, found.workspaceId);
        if (!switched.ok) failAndExit(`${commandName}に失敗しました: ${switched.error}`);
      }
      const switched = await switchBoard(endpoint, found.boardId);
      if (!switched.ok) failAndExit(`${commandName}に失敗しました: ${switched.error}`);
    }
    console.log(`board: ${found.boardId}`);
    return;
  }

  const created = await newBoard(endpoint, {
    ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
    cwd: path,
    activate: mode === "board-switch",
    worktreePath: path,
  });
  if (!created.ok) failAndExit(`${commandName}に失敗しました: ${created.error}`);
  // 遷移しないモードではサイドバーの見分けが唯一の手がかりになるため、必ずブランチ名を付ける
  if (branch !== null) {
    const renamed = await renameBoard(endpoint, created.boardId, branch);
    if (!renamed.ok) console.error(`warning: Board名を設定できませんでした: ${renamed.error}`);
  }
  console.log(`board: ${created.boardId}`);
}
