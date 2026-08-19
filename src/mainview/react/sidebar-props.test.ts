import { describe, expect, test } from "bun:test";
import type { TileLeaf, TileNode, TileSplit } from "../../bun/tile-layout";
import type { BoardListEntry } from "../../bun/workspace";
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

function board(
  boardId: string,
  layout: TileNode,
  options: {
    active?: boolean;
    focusedTileId?: string;
    tabVars?: Record<string, Record<string, string>>;
    name?: string | null;
  } = {},
): BoardListEntry {
  return {
    boardId,
    active: options.active ?? true,
    focusedTileId: options.focusedTileId ?? layout.id,
    layout,
    tabVars: options.tabVars ?? {},
    tabNames: {},
    tileNames: {},
    name: options.name ?? null,
  };
}

function workspace(
  workspaceId: string,
  boards: BoardListEntry[],
  options: {
    name?: string | null;
    popup?: WorkspaceListEntry["popup"];
  } = {},
): WorkspaceListEntry {
  return {
    workspaceId,
    active: false,
    activeBoardId: boards.find((b) => b.active)?.boardId ?? boards[0]?.boardId ?? "",
    boards,
    name: options.name ?? null,
    popup: options.popup ?? null,
  };
}

describe("buildSidebarWorkspaceItems", () => {
  test("Boardが1つのワークスペースはboards配列に1件、ラベルは1始まりの番号", () => {
    const workspaces = [
      workspace("ws-1", [board("board-1", leaf("tile-1", ["tab-1"], "tab-1"))]),
      workspace("ws-2", [board("board-2", leaf("tile-2", ["tab-2"], "tab-2"))]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-2");

    expect(items).toEqual([
      {
        workspaceId: "ws-1",
        label: "Workspace 1",
        active: false,
        popup: null,
        boards: [
          {
            boardId: "board-1",
            label: "Board 1",
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
        popup: null,
        boards: [
          {
            boardId: "board-2",
            label: "Board 1",
            active: true,
            branch: null,
            agent: null,
          },
        ],
      },
    ]);
  });

  test("Boardが複数ある場合はboardsに複数件、1始まりの番号で並ぶ", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1")),
        board("board-2", leaf("tile-2", ["tab-2"], "tab-2"), { active: false }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards.map((b) => ({ boardId: b.boardId, label: b.label }))).toEqual([
      { boardId: "board-1", label: "Board 1" },
      { boardId: "board-2", label: "Board 2" },
    ]);
  });

  test("Board.nameに設定があればデフォルトの連番の代わりにそれを使う", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), { name: "roadmap-doc" }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.label).toBe("roadmap-doc");
  });

  test("Workspace.nameに設定があればデフォルトの連番の代わりにそれを使う", () => {
    const workspaces = [
      workspace("ws-1", [board("board-1", leaf("tile-1", ["tab-1"], "tab-1"))], {
        name: "作業用",
      }),
      workspace("ws-2", [board("board-2", leaf("tile-2", ["tab-2"], "tab-2"))]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.label).toBe("作業用");
    expect(items[1]?.label).toBe("Workspace 2");
  });

  test("フォーカス中タイルのアクティブタブのbranchがBoardの状態として返る", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          tabVars: { "tab-1": { branch: "main" } },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.label).toBe("Board 1");
    expect(items[0]?.boards[0]?.branch).toBe("main");
  });

  test("フォーカス中タイルではない他タイルの変数はBoardの状態に反映されない", () => {
    const workspaces = [
      workspace("ws-1", [
        board(
          "board-1",
          split("split-1", leaf("tile-1", ["tab-1"], "tab-1"), leaf("tile-2", ["tab-2"], "tab-2")),
          {
            focusedTileId: "tile-2",
            tabVars: {
              "tab-1": { branch: "feature/not-focused" },
              "tab-2": { branch: "feature/focused" },
            },
          },
        ),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.branch).toBe("feature/focused");
  });

  test("agent未設定時はagent:null", () => {
    const workspaces = [workspace("ws-1", [board("board-1", leaf("tile-1", ["tab-1"], "tab-1"))])];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent).toBeNull();
  });

  test("agent設定・agent_status未設定時はstatus:idleへフォールバックする", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          tabVars: { "tab-1": { agent: "claude-code" } },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent).toEqual({
      agent: "claude-code",
      status: "idle",
      statusText: null,
    });
  });

  test("agent_statusにworking/blockedを設定した場合はそのまま反映される", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          tabVars: { "tab-1": { agent: "claude-code", agent_status: "working" } },
        }),
      ]),
      workspace("ws-2", [
        board("board-2", leaf("tile-2", ["tab-2"], "tab-2"), {
          tabVars: { "tab-2": { agent: "claude-code", agent_status: "blocked" } },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent?.status).toBe("working");
    expect(items[1]?.boards[0]?.agent?.status).toBe("blocked");
  });

  test("agent_statusが未知の値の場合はidleへ正規化する", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          tabVars: { "tab-1": { agent: "claude-code", agent_status: "foo" } },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent?.status).toBe("idle");
  });

  test("agent_status_textを設定した場合はstatusTextへ反映される", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          tabVars: {
            "tab-1": {
              agent: "claude-code",
              agent_status: "working",
              agent_status_text: "Edit: sidebar-workspace-list.tsx",
            },
          },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent?.statusText).toBe("Edit: sidebar-workspace-list.tsx");
  });

  test("agent_status_text未設定時はstatusText:null", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          tabVars: { "tab-1": { agent: "claude-code" } },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent?.statusText).toBeNull();
  });

  test("agentが空文字列（SessionEnd後を想定）の場合はagent:null", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          tabVars: { "tab-1": { agent: "", agent_status: "" } },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent).toBeNull();
  });

  test("非アクティブワークスペースのBoardは常にactive:falseになる", () => {
    const workspaces = [workspace("ws-1", [board("board-1", leaf("tile-1", ["tab-1"], "tab-1"))])];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-2");

    expect(items[0]?.active).toBe(false);
    expect(items[0]?.boards[0]?.active).toBe(false);
  });

  test("アクティブワークスペース内でも非アクティブなBoardはactive:falseになる", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), { active: true }),
        board("board-2", leaf("tile-2", ["tab-2"], "tab-2"), { active: false }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.active).toBe(true);
    expect(items[0]?.boards[1]?.active).toBe(false);
  });

  test('popupがあれば固定ラベル"Popup"とvisibleを含む（Workspace直下の状態のため、ADR 0006）', () => {
    const workspaces = [
      workspace("ws-1", [board("board-1", leaf("tile-1", ["tab-1"], "tab-1"))], {
        popup: { tabId: "tab-popup", visible: false },
      }),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.popup).toEqual({ tabId: "tab-popup", visible: false, label: "Popup" });
  });

  test("同一Workspace内の複数Boardが別々のagent状態を持てる", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          tabVars: { "tab-1": { agent: "claude-code", agent_status: "working" } },
        }),
        board("board-2", leaf("tile-2", ["tab-2"], "tab-2"), {
          active: false,
          tabVars: { "tab-2": { agent: "codex-cli", agent_status: "idle" } },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent).toEqual({
      agent: "claude-code",
      status: "working",
      statusText: null,
    });
    expect(items[0]?.boards[1]?.agent).toEqual({
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
