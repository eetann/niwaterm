import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import {
  resolveIpcEndpoint,
  listWorkspaces,
  type BoardListEntry,
  type TileSummary,
  type WorkspaceListEntry,
} from "../ipc-client";

function printTile(tile: TileSummary, focusedTileId: string, depth: number): void {
  const indent = "  ".repeat(depth);
  if (tile.kind === "leaf") {
    const suffix = tile.id === focusedTileId ? " (focused)" : "";
    console.log(`${indent}${tile.id}${suffix}`);
    for (const tabId of tile.tabIds) {
      const activeSuffix = tabId === tile.activeTabId ? " (active)" : "";
      console.log(`${indent}  ${tabId}${activeSuffix}`);
    }
    return;
  }
  const orientation = tile.direction === "row" ? "vertical" : "horizontal";
  console.log(`${indent}${tile.id} (split: ${orientation})`);
  printTile(tile.first, focusedTileId, depth + 1);
  printTile(tile.second, focusedTileId, depth + 1);
}

function printBoard(board: BoardListEntry, depth: number): void {
  const indent = "  ".repeat(depth);
  const suffix = board.active ? " (active)" : "";
  // 自動名はniwaterm側の表示と揃えるために出す（ユーザーが付けた名前と紛れないよう括弧なしにする）
  const name = board.name ?? board.autoName;
  const nameSuffix = name ? ` "${name}"` : "";
  const startupSuffix = board.startup
    ? ` [${board.startup.restoreMode === "layout" ? "startup" : "preset"}: ${board.startup.preset}]`
    : "";
  const phaseSuffix = board.phase ? ` [phase: ${board.phase}]` : "";
  console.log(`${indent}${board.boardId}${nameSuffix}${suffix}${startupSuffix}${phaseSuffix}`);
  printTile(board.layout, board.focusedTileId, depth + 1);
}

function printWorkspace(entry: WorkspaceListEntry): void {
  const suffix = entry.active ? " (active)" : "";
  const nameSuffix = entry.name ? ` "${entry.name}"` : "";
  console.log(`${entry.workspaceId}${nameSuffix}${suffix}`);
  // Board 1つのみ（大半のケース）はBoard行を省略し、直接タイル階層を表示する
  // （サイドバーの表示方針・ADR 0006と揃える）。ただしレイアウトプリセットが紐づいている
  // Boardは、board startupの対象を確認できるようBoard行を残す
  if (entry.boards.length === 1 && !entry.boards[0].startup && !entry.boards[0].phase) {
    printTile(entry.boards[0].layout, entry.boards[0].focusedTileId, 1);
    return;
  }
  for (const board of entry.boards) {
    printBoard(board, 1);
  }
}

export default define({
  name: "list",
  description: "ワークスペース・Board・タイル・タブの一覧を表示",
  run: async () => {
    const result = await listWorkspaces(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`niwatermに接続できませんでした: ${result.error}`);
    }
    for (const entry of result.workspaces) {
      printWorkspace(entry);
    }
  },
});
