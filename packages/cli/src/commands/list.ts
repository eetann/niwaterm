import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import {
  resolveIpcEndpoint,
  listWorkspaces,
  type BoardListEntry,
  type TabId,
  type TileSummary,
  type WorkspaceListEntry,
} from "../ipc-client";

/** 名前があればidの直後へ` "名前"`として差し込む。未設定は空文字列 */
function nameSuffix(name: string | null | undefined): string {
  return name ? ` "${name}"` : "";
}

function tileLines(
  tile: TileSummary,
  focusedTileId: string,
  tabNames: Record<TabId, string>,
  depth: number,
): string[] {
  const indent = "  ".repeat(depth);
  if (tile.kind === "leaf") {
    const suffix = tile.id === focusedTileId ? " (focused)" : "";
    const lines = [`${indent}${tile.id}${suffix}`];
    for (const tabId of tile.tabIds) {
      const activeSuffix = tabId === tile.activeTabId ? " (active)" : "";
      lines.push(`${indent}  ${tabId}${nameSuffix(tabNames[tabId])}${activeSuffix}`);
    }
    return lines;
  }
  const orientation = tile.direction === "row" ? "vertical" : "horizontal";
  return [
    `${indent}${tile.id} (split: ${orientation})`,
    ...tileLines(tile.first, focusedTileId, tabNames, depth + 1),
    ...tileLines(tile.second, focusedTileId, tabNames, depth + 1),
  ];
}

function boardLines(board: BoardListEntry, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const suffix = board.active ? " (active)" : "";
  // 自動名はniwaterm側の表示と揃えるために出す（ユーザーが付けた名前と紛れないよう括弧なしにする）
  const name = board.name ?? board.autoName;
  const startupSuffix = board.startup
    ? ` [${board.startup.restoreMode === "layout" ? "startup" : "preset"}: ${board.startup.preset}]`
    : "";
  const phaseSuffix = board.phase ? ` [phase: ${board.phase}]` : "";
  return [
    `${indent}${board.boardId}${nameSuffix(name)}${suffix}${startupSuffix}${phaseSuffix}`,
    ...tileLines(board.layout, board.focusedTileId, board.tabNames, depth + 1),
  ];
}

function workspaceLines(entry: WorkspaceListEntry): string[] {
  const suffix = entry.active ? " (active)" : "";
  const head = `${entry.workspaceId}${nameSuffix(entry.name)}${suffix}`;
  // Board 1つのみ（大半のケース）はBoard行を省略し、直接タイル階層を表示する
  // （サイドバーの表示方針・ADR 0006と揃える）。ただしレイアウトプリセットが紐づいている
  // Boardは、board startupの対象を確認できるようBoard行を残す
  const only = entry.boards.length === 1 ? entry.boards[0] : undefined;
  if (only && !only.startup && !only.phase) {
    return [head, ...tileLines(only.layout, only.focusedTileId, only.tabNames, 1)];
  }
  return [head, ...entry.boards.flatMap((board) => boardLines(board, 1))];
}

export function formatWorkspaceList(workspaces: WorkspaceListEntry[]): string[] {
  return workspaces.flatMap(workspaceLines);
}

export default define({
  name: "list",
  description: "ワークスペース・Board・タイル・タブの一覧を表示",
  run: async () => {
    const result = await listWorkspaces(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`niwatermに接続できませんでした: ${result.error}`);
    }
    for (const line of formatWorkspaceList(result.workspaces)) {
      console.log(line);
    }
  },
});
