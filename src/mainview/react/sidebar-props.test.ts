import { describe, expect, test } from "bun:test";
import type { TileLeaf, TileNode, TileSplit } from "../../bun/tile-layout";
import type { WorkspaceListEntry } from "../../bun/workspace-manager";
import {
  agentStatusBadgeClass,
  agentStatusBadgeLabel,
  buildSidebarWorkspaceItems,
} from "./sidebar-props";

function leaf(id: string, tabIds: string[], activeTabId: string): TileLeaf {
  return { kind: "leaf", id, tabIds, activeTabId };
}

function split(id: string, first: TileNode, second: TileNode): TileSplit {
  return { kind: "split", id, direction: "row", ratio: 0.5, first, second };
}

function workspace(
  workspaceId: string,
  layout: TileNode,
  tabVars: Record<string, Record<string, string>> = {},
  tabNames: Record<string, string> = {},
  tileNames: Record<string, string> = {},
): WorkspaceListEntry {
  return {
    workspaceId,
    active: false,
    focusedTileId: layout.id,
    layout,
    tabVars,
    tabNames,
    tileNames,
  };
}

describe("buildSidebarWorkspaceItems", () => {
  test("タイル1つのワークスペースはtiles配列に1件、タブラベルは1始まりの番号のみ", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1", "tab-2"], "tab-2")),
      workspace("ws-2", leaf("tile-2", ["tab-3"], "tab-3")),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-2");

    expect(items).toEqual([
      {
        workspaceId: "ws-1",
        label: "Workspace 1",
        active: false,
        tiles: [
          {
            tileId: "tile-1",
            label: "Tile 1",
            tabs: [
              {
                tabId: "tab-1",
                label: "Tab 1",
                active: false,
                branch: null,
                agent: null,
              },
              {
                tabId: "tab-2",
                label: "Tab 2",
                active: false,
                branch: null,
                agent: null,
              },
            ],
          },
        ],
      },
      {
        workspaceId: "ws-2",
        label: "Workspace 2",
        active: true,
        tiles: [
          {
            tileId: "tile-2",
            label: "Tile 1",
            tabs: [
              {
                tabId: "tab-3",
                label: "Tab 1",
                active: true,
                branch: null,
                agent: null,
              },
            ],
          },
        ],
      },
    ]);
  });

  test("タイルが複数ある場合はtilesに複数件、1始まりの番号で並ぶ", () => {
    const workspaces = [
      workspace(
        "ws-1",
        split("split-1", leaf("tile-1", ["tab-1"], "tab-1"), leaf("tile-2", ["tab-2"], "tab-2")),
      ),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles.map((t) => ({ tileId: t.tileId, label: t.label }))).toEqual([
      { tileId: "tile-1", label: "Tile 1" },
      { tileId: "tile-2", label: "Tile 2" },
    ]);
  });

  test("tabNames/tileNamesに設定があればデフォルトの連番の代わりにそれを使う", () => {
    const workspaces = [
      workspace(
        "ws-1",
        leaf("tile-1", ["tab-1", "tab-2"], "tab-1"),
        {},
        { "tab-1": "roadmap" },
        { "tile-1": "作業ペイン" },
      ),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles[0]?.label).toBe("作業ペイン");
    expect(items[0]?.tiles[0]?.tabs[0]?.label).toBe("roadmap");
    expect(items[0]?.tiles[0]?.tabs[1]?.label).toBe("Tab 2");
  });

  test("tabVarsのbranchは独立フィールドとして返る（ラベルには含めない）", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": { branch: "main" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles[0]?.tabs[0]?.label).toBe("Tab 1");
    expect(items[0]?.tiles[0]?.tabs[0]?.branch).toBe("main");
  });

  test("agent未設定時はagent:null", () => {
    const workspaces = [workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"))];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles[0]?.tabs[0]?.agent).toBeNull();
  });

  test("agent設定・agent_status未設定時はstatus:idleへフォールバックする", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": { agent: "claude-code" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles[0]?.tabs[0]?.agent).toEqual({
      agent: "claude-code",
      status: "idle",
      statusText: null,
    });
  });

  test("agent_statusにworking/blockedを設定した場合はそのまま反映される", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": { agent: "claude-code", agent_status: "working" },
      }),
      workspace("ws-2", leaf("tile-2", ["tab-2"], "tab-2"), {
        "tab-2": { agent: "claude-code", agent_status: "blocked" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles[0]?.tabs[0]?.agent?.status).toBe("working");
    expect(items[1]?.tiles[0]?.tabs[0]?.agent?.status).toBe("blocked");
  });

  test("agent_statusが未知の値の場合はidleへ正規化する", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": { agent: "claude-code", agent_status: "foo" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles[0]?.tabs[0]?.agent?.status).toBe("idle");
  });

  test("agent_status_textを設定した場合はstatusTextへ反映される", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": {
          agent: "claude-code",
          agent_status: "working",
          agent_status_text: "Edit: sidebar-workspace-list.tsx",
        },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles[0]?.tabs[0]?.agent?.statusText).toBe("Edit: sidebar-workspace-list.tsx");
  });

  test("agent_status_text未設定時はstatusText:null", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": { agent: "claude-code" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles[0]?.tabs[0]?.agent?.statusText).toBeNull();
  });

  test("agentが空文字列（SessionEnd後を想定）の場合はagent:null", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": { agent: "", agent_status: "" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles[0]?.tabs[0]?.agent).toBeNull();
  });

  test("非アクティブワークスペースのタブは常にactive:falseになる", () => {
    const workspaces = [workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"))];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-2");

    expect(items[0]?.active).toBe(false);
    expect(items[0]?.tiles[0]?.tabs[0]?.active).toBe(false);
  });

  test("同一タイル内の複数タブが別々のagent状態を持てる（タブ単位化の主目的）", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1", "tab-2"], "tab-1"), {
        "tab-1": { agent: "claude-code", agent_status: "working" },
        "tab-2": { agent: "codex-cli", agent_status: "idle" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tiles[0]?.tabs[0]?.agent).toEqual({
      agent: "claude-code",
      status: "working",
      statusText: null,
    });
    expect(items[0]?.tiles[0]?.tabs[1]?.agent).toEqual({
      agent: "codex-cli",
      status: "idle",
      statusText: null,
    });
  });
});

describe("agentStatusBadgeLabel", () => {
  test("working/blockedはラベルを返し、idleはバッジを出さずnullを返す", () => {
    expect(agentStatusBadgeLabel("working")).toBe("作業中");
    expect(agentStatusBadgeLabel("blocked")).toBe("応答待ち");
    expect(agentStatusBadgeLabel("idle")).toBeNull();
  });
});

describe("agentStatusBadgeClass", () => {
  test("working/blockedそれぞれに対応する配色クラスを返す", () => {
    expect(agentStatusBadgeClass("working")).toBe("text-blue-500 bg-blue-500/15");
    expect(agentStatusBadgeClass("blocked")).toBe("text-amber-500 bg-amber-500/15");
  });
});
