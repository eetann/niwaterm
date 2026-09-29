import { describe, expect, test } from "bun:test";
import type { WorkspaceListEntry } from "../ipc-client";
import { fromConfig, fromWorkspaces } from "./sources";

function workspace(overrides: Partial<WorkspaceListEntry> = {}): WorkspaceListEntry {
  return {
    workspaceId: "workspace-0",
    active: true,
    activeBoardId: "board-1",
    name: null,
    boards: [
      {
        boardId: "board-1",
        active: true,
        focusedTileId: "tile-2",
        name: "niwaterm",
        autoName: null,
        startup: null,
        worktreePath: null,
        worktreeMissing: false,
        phase: null,
        layout: {
          kind: "split",
          id: "tile-1",
          direction: "row",
          ratio: 0.5,
          first: { kind: "leaf", id: "tile-2", tabIds: ["tab-3", "tab-4"], activeTabId: "tab-3" },
          second: { kind: "leaf", id: "tile-5", tabIds: ["tab-6"], activeTabId: "tab-6" },
        },
      },
    ],
    ...overrides,
  };
}

describe("fromWorkspaces", () => {
  test("分割されたタイルの奥にあるタブまで候補にする", () => {
    const sources = fromWorkspaces([workspace()]);
    expect(sources.get("tabId")?.map((item) => item.value)).toEqual(["tab-3", "tab-4", "tab-6"]);
  });

  test("タイルはleafだけを候補にする（splitは操作対象にならない）", () => {
    const sources = fromWorkspaces([workspace()]);
    expect(sources.get("tileId")?.map((item) => item.value)).toEqual(["tile-2", "tile-5"]);
  });

  test("IDだけでは区別が付かないため、説明にBoardとワークスペースの名前を添える", () => {
    const sources = fromWorkspaces([workspace()]);
    expect(sources.get("boardId")).toEqual([
      { value: "board-1", description: "niwaterm @workspace-0 (active)" },
    ]);
  });

  test("名前の無いワークスペースはIDで代用する", () => {
    const sources = fromWorkspaces([workspace({ name: null })]);
    expect(sources.get("workspaceId")).toEqual([
      { value: "workspace-0", description: "workspace-0 (active)" },
    ]);
  });
});

describe("fromConfig", () => {
  const sections = (entries: { key: string; value: string }[], name = "customViews") => [
    { name, entries },
  ];

  test("customViewsのキーがそのままビューのid", () => {
    const sources = fromConfig(sections([{ key: "notes", value: "Notes (file:///notes.html)" }]));
    expect(sources.get("customView")).toEqual([{ value: "notes", description: "Notes" }]);
  });

  test("サイドバーには組み込みのワークスペース一覧も混ぜる", () => {
    const sources = fromConfig(sections([{ key: "notes", value: "Notes (file:///notes.html)" }]));
    expect(sources.get("sidebarView")?.map((item) => item.value)).toEqual(["notes", "workspaces"]);
  });

  test("customViewが1つも無いときのプレースホルダは候補にしない", () => {
    const sources = fromConfig(sections([{ key: "views", value: "(未設定)" }]));
    expect(sources.get("customView")).toEqual([]);
  });

  test("フェーズはカンマ区切りの1つの値として届く", () => {
    const sources = fromConfig(sections([{ key: "phases", value: "plan, implement" }], "board"));
    expect(sources.get("boardPhase")).toEqual([{ value: "plan" }, { value: "implement" }]);
  });

  test("フェーズが1つでも候補になる", () => {
    const sources = fromConfig(sections([{ key: "phases", value: "plan" }], "board"));
    expect(sources.get("boardPhase")).toEqual([{ value: "plan" }]);
  });

  test("フェーズ未設定の表示用文字列は候補にしない", () => {
    const sources = fromConfig(sections([{ key: "phases", value: "(なし)" }], "board"));
    expect(sources.get("boardPhase")).toEqual([]);
  });

  test("ステータスバーは部品のidが候補で、出さない設定のプレースホルダは除く", () => {
    const sources = fromConfig(
      sections(
        [
          { key: "git", value: "tab-var:branch" },
          { key: "right-1", value: "builtin:cwd" },
        ],
        "statusBar",
      ),
    );
    expect(sources.get("statusBarItem")).toEqual([
      { value: "git", description: "tab-var:branch" },
      { value: "right-1", description: "builtin:cwd" },
    ]);
    const hidden = fromConfig(sections([{ key: "items", value: "(なし)" }], "statusBar"));
    expect(hidden.get("statusBarItem")).toEqual([]);
  });
});
