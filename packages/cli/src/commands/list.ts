import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import {
  ipcSocketPath,
  listWorkspaces,
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

function printWorkspace(entry: WorkspaceListEntry): void {
  const suffix = entry.active ? " (active)" : "";
  console.log(`${entry.workspaceId}${suffix}`);
  printTile(entry.layout, entry.focusedTileId, 1);
}

export default define({
  name: "list",
  description: "ワークスペース・タイル・タブの一覧を表示",
  run: async () => {
    const result = await listWorkspaces(ipcSocketPath());
    if (!result.ok) {
      failAndExit(`niwatermに接続できませんでした: ${result.error}`);
    }
    for (const entry of result.workspaces) {
      printWorkspace(entry);
    }
  },
});
