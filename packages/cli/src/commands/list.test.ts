import { describe, expect, test } from "bun:test";
import type { BoardListEntry, TileSummary, WorkspaceListEntry } from "../ipc-client";
import { formatWorkspaceList } from "./list";

function leaf(id: string, tabIds: string[]): TileSummary {
  return { kind: "leaf", id, tabIds, activeTabId: tabIds[0] as string };
}

function board(overrides: Partial<BoardListEntry> = {}): BoardListEntry {
  return {
    boardId: "board-1",
    active: true,
    focusedTileId: "tile-1",
    layout: leaf("tile-1", ["tab-1"]),
    tabNames: {},
    name: null,
    autoName: null,
    startup: null,
    worktreePath: null,
    worktreeMissing: false,
    phase: null,
    ...overrides,
  };
}

function workspace(overrides: Partial<WorkspaceListEntry> = {}): WorkspaceListEntry {
  return {
    workspaceId: "workspace-1",
    active: true,
    activeBoardId: "board-1",
    boards: [board()],
    name: null,
    ...overrides,
  };
}

describe("formatWorkspaceList", () => {
  test("名前を付けたタブにはtabIdの後ろへ名前を添える", () => {
    const lines = formatWorkspaceList([
      workspace({
        boards: [
          board({
            layout: leaf("tile-1", ["tab-1", "tab-2"]),
            tabNames: { "tab-2": "editor" },
          }),
        ],
      }),
    ]);
    expect(lines).toEqual([
      "workspace-1 (active)",
      "  tile-1 (focused)",
      "    tab-1 (active)",
      '    tab-2 "editor"',
    ]);
  });

  test("ワークスペース名・Board名・タブ名を同じ階層表示の中に並べる", () => {
    const lines = formatWorkspaceList([
      workspace({
        name: "dev",
        boards: [
          board({ phase: "review", tabNames: { "tab-1": "logs" } }),
          board({
            boardId: "board-2",
            active: false,
            focusedTileId: "tile-2",
            layout: leaf("tile-2", ["tab-2"]),
            name: "docs",
          }),
        ],
      }),
    ]);
    expect(lines).toEqual([
      'workspace-1 "dev" (active)',
      "  board-1 (active) [phase: review]",
      "    tile-1 (focused)",
      '      tab-1 "logs" (active)',
      '  board-2 "docs"',
      "    tile-2 (focused)",
      "      tab-2 (active)",
    ]);
  });

  test("split配下のタブにも名前が付く", () => {
    const lines = formatWorkspaceList([
      workspace({
        boards: [
          board({
            layout: {
              kind: "split",
              id: "tile-0",
              direction: "row",
              ratio: 0.5,
              first: leaf("tile-1", ["tab-1"]),
              second: leaf("tile-2", ["tab-2"]),
            },
            tabNames: { "tab-1": "server", "tab-2": "client" },
          }),
        ],
      }),
    ]);
    expect(lines).toEqual([
      "workspace-1 (active)",
      "  tile-0 (split: vertical)",
      "    tile-1 (focused)",
      '      tab-1 "server" (active)',
      "    tile-2",
      '      tab-2 "client" (active)',
    ]);
  });
});
