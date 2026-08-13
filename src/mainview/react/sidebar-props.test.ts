import { describe, expect, test } from "bun:test";
import type { TileLeaf } from "../../bun/tile-layout";
import type { WorkspaceListEntry } from "../../bun/workspace-manager";
import { agentStatusDotClass, buildSidebarWorkspaceItems } from "./sidebar-props";

function leaf(id: string, tabIds: string[], activeTabId: string): TileLeaf {
  return { kind: "leaf", id, tabIds, activeTabId };
}

function workspace(
  workspaceId: string,
  layout: TileLeaf,
  tabVars: Record<string, Record<string, string>> = {},
): WorkspaceListEntry {
  return {
    workspaceId,
    active: false,
    focusedTileId: layout.id,
    layout,
    tabVars,
  };
}

describe("buildSidebarWorkspaceItems", () => {
  test("ワークスペース・タブのラベルを1始まりの番号で組み立てる", () => {
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
        tabs: [
          {
            tabId: "tab-1",
            tileId: "tile-1",
            label: "Tile 1 / Tab 1",
            active: false,
            branch: null,
            agent: null,
          },
          {
            tabId: "tab-2",
            tileId: "tile-1",
            label: "Tile 1 / Tab 2",
            active: false,
            branch: null,
            agent: null,
          },
        ],
      },
      {
        workspaceId: "ws-2",
        label: "Workspace 2",
        active: true,
        tabs: [
          {
            tabId: "tab-3",
            tileId: "tile-2",
            label: "Tile 1 / Tab 1",
            active: true,
            branch: null,
            agent: null,
          },
        ],
      },
    ]);
  });

  test("tabVarsのbranchは独立フィールドとして返る（ラベルには含めない）", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": { branch: "main" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tabs[0]?.label).toBe("Tile 1 / Tab 1");
    expect(items[0]?.tabs[0]?.branch).toBe("main");
  });

  test("agent未設定時はagent:null", () => {
    const workspaces = [workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"))];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tabs[0]?.agent).toBeNull();
  });

  test("agent設定・agent_status未設定時はstatus:idleへフォールバックする", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": { agent: "claude-code" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tabs[0]?.agent).toEqual({ agent: "claude-code", status: "idle" });
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

    expect(items[0]?.tabs[0]?.agent?.status).toBe("working");
    expect(items[1]?.tabs[0]?.agent?.status).toBe("blocked");
  });

  test("agent_statusが未知の値の場合はidleへ正規化する", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": { agent: "claude-code", agent_status: "foo" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tabs[0]?.agent?.status).toBe("idle");
  });

  test("agentが空文字列（SessionEnd後を想定）の場合はagent:null", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        "tab-1": { agent: "", agent_status: "" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tabs[0]?.agent).toBeNull();
  });

  test("非アクティブワークスペースのタブは常にactive:falseになる", () => {
    const workspaces = [workspace("ws-1", leaf("tile-1", ["tab-1"], "tab-1"))];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-2");

    expect(items[0]?.active).toBe(false);
    expect(items[0]?.tabs[0]?.active).toBe(false);
  });

  test("同一タイル内の複数タブが別々のagent状態を持てる（タブ単位化の主目的）", () => {
    const workspaces = [
      workspace("ws-1", leaf("tile-1", ["tab-1", "tab-2"], "tab-1"), {
        "tab-1": { agent: "claude-code", agent_status: "working" },
        "tab-2": { agent: "codex-cli", agent_status: "idle" },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.tabs[0]?.agent).toEqual({ agent: "claude-code", status: "working" });
    expect(items[0]?.tabs[1]?.agent).toEqual({ agent: "codex-cli", status: "idle" });
  });
});

describe("agentStatusDotClass", () => {
  test("working/blocked/idleそれぞれに対応する色クラスを返す", () => {
    expect(agentStatusDotClass("working")).toBe("bg-blue-500");
    expect(agentStatusDotClass("blocked")).toBe("bg-amber-500");
    expect(agentStatusDotClass("idle")).toBe("bg-emerald-500");
  });
});
