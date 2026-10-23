import { describe, expect, test } from "bun:test";
import { describeTab } from "./tab-info";
import type { BoardStatusEntry, WorkspaceListEntry } from "./workspace-manager";

function boardEntry(overrides: Partial<BoardStatusEntry> = {}): BoardStatusEntry {
  return {
    boardId: "board-1",
    active: true,
    focusedTileId: "tile-2",
    layout: {
      kind: "split",
      id: "tile-0",
      direction: "column",
      ratio: 0.5,
      first: { kind: "leaf", id: "tile-1", tabIds: ["tab-1", "tab-2"], activeTabId: "tab-2" },
      second: { kind: "leaf", id: "tile-2", tabIds: ["tab-3"], activeTabId: "tab-3" },
    },
    tabVars: {},
    tabNames: { "tab-1": "editor" },
    tileNames: { "tile-1": "main" },
    tabKinds: {},
    name: null,
    autoName: "repo",
    zoomedTileId: null,
    startup: null,
    worktreePath: null,
    phase: null,
    resume: null,
    worktreeMissing: false,
    ...overrides,
  };
}

function workspaceEntry(
  boards: BoardStatusEntry[],
  overrides: Partial<WorkspaceListEntry> = {},
): WorkspaceListEntry {
  return {
    workspaceId: "workspace-1",
    active: true,
    activeBoardId: "board-1",
    boards,
    name: "dev",
    popup: null,
    ...overrides,
  };
}

describe("describeTab", () => {
  test("タブの所属ワークスペース・Board・タイルと、それぞれの名前を返す", () => {
    expect(describeTab([workspaceEntry([boardEntry()])], "tab-1")).toEqual({
      workspace: { id: "workspace-1", name: "dev" },
      board: { id: "board-1", name: "repo" },
      tile: { id: "tile-1", name: "main" },
      tab: { id: "tab-1", name: "editor" },
    });
  });

  test("名前が無いタイル・タブはnull、Boardはユーザーが付けた名前を自動名より優先する", () => {
    const info = describeTab([workspaceEntry([boardEntry({ name: "review" })])], "tab-3");
    expect(info?.board).toEqual({ id: "board-1", name: "review" });
    expect(info?.tile).toEqual({ id: "tile-2", name: null });
    expect(info?.tab).toEqual({ id: "tab-3", name: null });
  });

  test("アクティブでないBoard・ワークスペースに居るタブも引ける", () => {
    const other = workspaceEntry(
      [
        boardEntry({
          boardId: "board-9",
          layout: { kind: "leaf", id: "tile-9", tabIds: ["tab-9"], activeTabId: "tab-9" },
        }),
      ],
      { workspaceId: "workspace-2", active: false, activeBoardId: "board-9", name: null },
    );
    const info = describeTab([workspaceEntry([boardEntry()]), other], "tab-9");
    expect(info?.workspace).toEqual({ id: "workspace-2", name: null });
    expect(info?.board?.id).toBe("board-9");
    expect(info?.tile?.id).toBe("tile-9");
  });

  test("ポップアップのタブはタイルをnullにし、表示中のBoardを所属とする", () => {
    const boards = [
      boardEntry({ boardId: "board-1", active: false }),
      boardEntry({
        boardId: "board-2",
        name: "second",
        layout: { kind: "leaf", id: "tile-5", tabIds: ["tab-5"], activeTabId: "tab-5" },
      }),
    ];
    const ws = workspaceEntry(boards, {
      activeBoardId: "board-2",
      popup: { tabId: "tab-popup", visible: true },
    });
    expect(describeTab([ws], "tab-popup")).toEqual({
      workspace: { id: "workspace-1", name: "dev" },
      board: { id: "board-2", name: "second" },
      tile: null,
      tab: { id: "tab-popup", name: null },
    });
  });

  test("見つからないtabIdはnull", () => {
    expect(describeTab([workspaceEntry([boardEntry()])], "tab-404")).toBeNull();
  });
});
