import { describe, expect, test } from "bun:test";
import type { TileSummary, WorkspaceListEntry } from "../ipc-client";
import { replaceClosesExistingTabs } from "./layout";

function leaf(id: string, tabIds: string[]): TileSummary {
  return { kind: "leaf", id, tabIds, activeTabId: tabIds[0] as string };
}

function split(id: string, first: TileSummary, second: TileSummary): TileSummary {
  return { kind: "split", id, direction: "row", ratio: 0.5, first, second };
}

function workspace(
  overrides: Partial<WorkspaceListEntry> & { workspaceId: string; layout: TileSummary },
): WorkspaceListEntry {
  const { layout, ...rest } = overrides;
  return {
    active: true,
    activeBoardId: "board-1",
    name: null,
    boards: [
      {
        boardId: "board-1",
        active: true,
        focusedTileId: layout.id,
        layout,
        tabNames: {},
        name: null,
        autoName: null,
        startup: null,
        worktreePath: null,
        worktreeMissing: false,
        phase: null,
      },
    ],
    ...rest,
  };
}

describe("replaceClosesExistingTabs", () => {
  test("アクティブBoardがタイル1つ・タブ1つなら閉じるものが無い", () => {
    const workspaces = [workspace({ workspaceId: "ws-1", layout: leaf("tile-1", ["tab-1"]) })];
    expect(replaceClosesExistingTabs(workspaces, undefined)).toBe(false);
  });

  test("タイルが分割されていれば閉じるものがある", () => {
    const layout = split("tile-0", leaf("tile-1", ["tab-1"]), leaf("tile-2", ["tab-2"]));
    expect(replaceClosesExistingTabs([workspace({ workspaceId: "ws-1", layout })], undefined)).toBe(
      true,
    );
  });

  test("タイルが1つでもタブが複数なら閉じるものがある", () => {
    const workspaces = [
      workspace({ workspaceId: "ws-1", layout: leaf("tile-1", ["tab-1", "tab-2"]) }),
    ];
    expect(replaceClosesExistingTabs(workspaces, undefined)).toBe(true);
  });

  test("boardId指定時は非アクティブなWorkspaceのBoardも見る", () => {
    const workspaces = [
      workspace({ workspaceId: "ws-1", layout: leaf("tile-1", ["tab-1", "tab-2"]) }),
      workspace({
        workspaceId: "ws-2",
        active: false,
        activeBoardId: "board-2",
        layout: leaf("tile-9", ["tab-9"]),
        boards: [
          {
            boardId: "board-2",
            active: false,
            focusedTileId: "tile-9",
            layout: leaf("tile-9", ["tab-9"]),
            tabNames: {},
            name: null,
            autoName: null,
            startup: null,
            worktreePath: null,
            worktreeMissing: false,
            phase: null,
          },
        ],
      }),
    ];
    expect(replaceClosesExistingTabs(workspaces, "board-2")).toBe(false);
  });

  test("対象Boardが見つからなければ安全側で確認させる", () => {
    const workspaces = [workspace({ workspaceId: "ws-1", layout: leaf("tile-1", ["tab-1"]) })];
    expect(replaceClosesExistingTabs(workspaces, "board-missing")).toBe(true);
    expect(replaceClosesExistingTabs([], undefined)).toBe(true);
  });
});
