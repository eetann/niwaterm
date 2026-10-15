// `niwa list`（CLI）と`niwa.list()`（キーバインドの関数）が返す一覧を組み立てる。
// サイドバー用のWorkspaceListEntryはタブの情報がtabIdをキーにした辞書へ分散しているため、
// スクリプトから辿りやすいようタイル・タブをそれぞれ1つの配列へまとめ直す。

import type {
  NiwaListBoard,
  NiwaListLayoutNode,
  NiwaListTab,
  NiwaListTile,
  NiwaListTree,
} from "@niwaterm/config";
import { listLeaves, type TileNode } from "./tile-layout";
import type { BoardStatusEntry, WorkspaceListEntry } from "./workspace-manager";

function toLayoutNode(node: TileNode): NiwaListLayoutNode {
  if (node.kind === "leaf") return { kind: "leaf", id: node.id };
  return {
    kind: "split",
    id: node.id,
    orientation: node.direction === "row" ? "vertical" : "horizontal",
    ratio: node.ratio,
    first: toLayoutNode(node.first),
    second: toLayoutNode(node.second),
  };
}

function toBoard(board: BoardStatusEntry): NiwaListBoard {
  const tiles: NiwaListTile[] = [];
  const tabs: NiwaListTab[] = [];
  for (const leaf of listLeaves(board.layout)) {
    tiles.push({
      id: leaf.id,
      name: board.tileNames[leaf.id] ?? null,
      focused: leaf.id === board.focusedTileId,
      zoomed: leaf.id === board.zoomedTileId,
      activeTabId: leaf.activeTabId,
      tabIds: [...leaf.tabIds],
    });
    for (const tabId of leaf.tabIds) {
      const kind = board.tabKinds[tabId];
      const vars = board.tabVars[tabId] ?? {};
      tabs.push({
        id: tabId,
        tileId: leaf.id,
        kind: kind?.kind ?? "terminal",
        name: board.tabNames[tabId] ?? null,
        active: tabId === leaf.activeTabId,
        cwd: vars["cwd"] ?? null,
        url: kind?.kind === "browser" ? kind.url : null,
        exited: kind?.kind === "terminal" ? kind.exited : false,
        vars: { ...vars },
      });
    }
  }
  return {
    id: board.boardId,
    name: board.name,
    autoName: board.autoName,
    active: board.active,
    phase: board.phase,
    worktreePath: board.worktreePath,
    worktreeMissing: board.worktreeMissing,
    startup: board.startup
      ? { preset: board.startup.preset, restoreMode: board.startup.restoreMode }
      : null,
    layout: toLayoutNode(board.layout),
    tiles,
    tabs,
  };
}

export function buildListTree(workspaces: WorkspaceListEntry[]): NiwaListTree {
  return {
    workspaces: workspaces.map((entry) => ({
      id: entry.workspaceId,
      name: entry.name,
      active: entry.active,
      boards: entry.boards.map(toBoard),
    })),
  };
}
