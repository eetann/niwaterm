import { describe, expect, test } from "bun:test";
import type { ListTreeBoard, ListTreeTab, ListTreeTile, ListTreeWorkspace } from "../ipc-client";
import { formatListTree, type ListPalette } from "./list";

function tile(id: string, tabIds: string[], overrides: Partial<ListTreeTile> = {}): ListTreeTile {
  return {
    id,
    name: null,
    focused: false,
    zoomed: false,
    activeTabId: tabIds[0] as string,
    tabIds,
    ...overrides,
  };
}

function tab(id: string, tileId: string, overrides: Partial<ListTreeTab> = {}): ListTreeTab {
  return {
    id,
    tileId,
    kind: "terminal",
    name: null,
    active: false,
    cwd: null,
    url: null,
    exited: false,
    vars: {},
    ...overrides,
  };
}

function board(overrides: Partial<ListTreeBoard> = {}): ListTreeBoard {
  return {
    id: "board-1",
    name: null,
    autoName: null,
    active: true,
    phase: null,
    worktreePath: null,
    worktreeMissing: false,
    startup: null,
    layout: { kind: "leaf", id: "tile-1" },
    tiles: [tile("tile-1", ["tab-1"], { focused: true })],
    tabs: [tab("tab-1", "tile-1", { active: true })],
    ...overrides,
  };
}

function workspace(overrides: Partial<ListTreeWorkspace> = {}): ListTreeWorkspace {
  return { id: "workspace-1", name: null, active: true, boards: [board()], ...overrides };
}

describe("formatListTree", () => {
  test("名前を付けたタブにはtabIdの後ろへ名前を添える", () => {
    const lines = formatListTree({
      workspaces: [
        workspace({
          boards: [
            board({
              tiles: [tile("tile-1", ["tab-1", "tab-2"], { focused: true })],
              tabs: [
                tab("tab-1", "tile-1", { active: true }),
                tab("tab-2", "tile-1", { name: "editor" }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(lines).toEqual([
      "workspace-1 (active)",
      "  tile-1 (focused)",
      "    tab-1 (active)",
      '    tab-2 "editor"',
    ]);
  });

  test("ワークスペース名・Board名・タブ名を同じ階層表示の中に並べる", () => {
    const lines = formatListTree({
      workspaces: [
        workspace({
          name: "dev",
          boards: [
            board({
              phase: "review",
              tabs: [tab("tab-1", "tile-1", { active: true, name: "logs" })],
            }),
            board({
              id: "board-2",
              active: false,
              name: "docs",
              layout: { kind: "leaf", id: "tile-2" },
              tiles: [tile("tile-2", ["tab-2"], { focused: true })],
              tabs: [tab("tab-2", "tile-2", { active: true })],
            }),
          ],
        }),
      ],
    });
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

  test("split配下のタイルとタブを分割の木の順に並べる", () => {
    const lines = formatListTree({
      workspaces: [
        workspace({
          boards: [
            board({
              layout: {
                kind: "split",
                id: "tile-0",
                orientation: "vertical",
                ratio: 0.5,
                first: { kind: "leaf", id: "tile-1" },
                second: { kind: "leaf", id: "tile-2" },
              },
              tiles: [tile("tile-1", ["tab-1"], { focused: true }), tile("tile-2", ["tab-2"])],
              tabs: [
                tab("tab-1", "tile-1", { active: true, name: "server" }),
                tab("tab-2", "tile-2", { active: true, name: "client" }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(lines).toEqual([
      "workspace-1 (active)",
      "  tile-0 (split: vertical)",
      "    tile-1 (focused)",
      '      tab-1 "server" (active)',
      "    tile-2",
      '      tab-2 "client" (active)',
    ]);
  });

  test("タイル名・ズーム・ブラウザタブのURL・終了したタブを添える", () => {
    const lines = formatListTree({
      workspaces: [
        workspace({
          boards: [
            board({
              tiles: [
                tile("tile-1", ["tab-1", "tab-2"], { name: "main", focused: true, zoomed: true }),
              ],
              tabs: [
                tab("tab-1", "tile-1", { active: true, exited: true }),
                tab("tab-2", "tile-1", { kind: "browser", url: "https://example.com" }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(lines).toEqual([
      "workspace-1 (active)",
      '  tile-1 "main" (focused) (zoomed)',
      "    tab-1 (active) (exited)",
      "    tab-2 [browser: https://example.com]",
    ]);
  });

  test("役割ごとに色付けの関数を通す", () => {
    const tagged: ListPalette = {
      name: (text) => `<name>${text}`,
      state: (text) => `<state>${text}`,
      muted: (text) => `<muted>${text}`,
      tag: (text) => `<tag>${text}`,
      alert: (text) => `<alert>${text}`,
    };
    const lines = formatListTree(
      {
        workspaces: [
          workspace({
            name: "dev",
            boards: [board({ phase: "review" })],
          }),
        ],
      },
      tagged,
    );
    expect(lines).toEqual([
      'workspace-1 <name>"dev" <state>(active)',
      "  board-1 <state>(active) <tag>[phase: review]",
      "    tile-1 <state>(focused)",
      "      tab-1 <state>(active)",
    ]);
  });
});
