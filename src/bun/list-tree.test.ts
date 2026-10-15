import { describe, expect, test } from "bun:test";
import { buildListTree } from "./list-tree";
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
      ratio: 0.3,
      first: { kind: "leaf", id: "tile-1", tabIds: ["tab-1", "tab-2"], activeTabId: "tab-2" },
      second: { kind: "leaf", id: "tile-2", tabIds: ["tab-3"], activeTabId: "tab-3" },
    },
    tabVars: { "tab-1": { cwd: "/repo", branch: "main" }, "tab-2": {}, "tab-3": {} },
    tabNames: { "tab-1": "editor" },
    tileNames: { "tile-2": "logs" },
    tabKinds: {
      "tab-1": { kind: "terminal", exited: false },
      "tab-2": { kind: "browser", url: "https://example.com" },
      "tab-3": { kind: "terminal", exited: true },
    },
    name: null,
    autoName: "repo",
    zoomedTileId: "tile-2",
    startup: { preset: "dev", restoreMode: "layout", projectRoot: "/repo" },
    worktreePath: null,
    phase: null,
    resume: null,
    worktreeMissing: false,
    ...overrides,
  };
}

function workspaceEntry(boards: BoardStatusEntry[]): WorkspaceListEntry {
  return {
    workspaceId: "workspace-1",
    active: true,
    activeBoardId: "board-1",
    boards,
    name: "dev",
    popup: null,
  };
}

describe("buildListTree", () => {
  test("タイル・タブを分割の木の順に1つの配列へまとめる", () => {
    const tree = buildListTree([workspaceEntry([boardEntry()])]);
    const board = tree.workspaces[0]?.boards[0];
    expect(tree.workspaces[0]).toMatchObject({ id: "workspace-1", name: "dev", active: true });
    expect(board?.layout).toEqual({
      kind: "split",
      id: "tile-0",
      orientation: "horizontal",
      ratio: 0.3,
      first: { kind: "leaf", id: "tile-1" },
      second: { kind: "leaf", id: "tile-2" },
    });
    expect(board?.tiles).toEqual([
      {
        id: "tile-1",
        name: null,
        focused: false,
        zoomed: false,
        activeTabId: "tab-2",
        tabIds: ["tab-1", "tab-2"],
      },
      {
        id: "tile-2",
        name: "logs",
        focused: true,
        zoomed: true,
        activeTabId: "tab-3",
        tabIds: ["tab-3"],
      },
    ]);
    expect(board?.tabs).toEqual([
      {
        id: "tab-1",
        tileId: "tile-1",
        kind: "terminal",
        name: "editor",
        active: false,
        cwd: "/repo",
        url: null,
        exited: false,
        vars: { cwd: "/repo", branch: "main" },
      },
      {
        id: "tab-2",
        tileId: "tile-1",
        kind: "browser",
        name: null,
        active: true,
        cwd: null,
        url: "https://example.com",
        exited: false,
        vars: {},
      },
      {
        id: "tab-3",
        tileId: "tile-2",
        kind: "terminal",
        name: null,
        active: true,
        cwd: null,
        url: null,
        exited: true,
        vars: {},
      },
    ]);
  });

  test("startupはプリセット名と組み直し方だけを出す", () => {
    const board = buildListTree([workspaceEntry([boardEntry()])]).workspaces[0]?.boards[0];
    expect(board?.startup).toEqual({ preset: "dev", restoreMode: "layout" });
    expect(board?.autoName).toBe("repo");
  });
});
