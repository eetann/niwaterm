import { describe, expect, test } from "bun:test";
import { normalizeSidebarBoardStatus } from "@niwaterm/config";
import type { TileLeaf, TileNode, TileSplit } from "../../bun/tile-layout";
import type { BoardStatusEntry, WorkspaceListEntry } from "../../bun/workspace-manager";
import {
  agentStatusBadgeLabel,
  buildSidebarWorkspaceItems,
  type SidebarBoardItem,
  sidebarDropIndex,
} from "./sidebar-props";

/** ステータスラインのうち、指定した出どころのテキスト行の値。出ていなければnull */
function statusTextOf(board: SidebarBoardItem | undefined, id: string): string | null {
  const line = board?.statusItems.find((item) => item.id === id);
  return line?.kind === "text" ? line.value : null;
}

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
    autoName?: string | null;
    zoomedTileId?: string | null;
    startup?: BoardStatusEntry["startup"];
    worktreePath?: string | null;
    worktreeMissing?: boolean;
    phase?: string | null;
  } = {},
): BoardStatusEntry {
  return {
    boardId,
    active: options.active ?? true,
    focusedTileId: options.focusedTileId ?? layout.id,
    layout,
    tabVars: options.tabVars ?? {},
    tabNames: {},
    tileNames: {},
    name: options.name ?? null,
    autoName: options.autoName ?? null,
    zoomedTileId: options.zoomedTileId ?? null,
    startup: options.startup ?? null,
    worktreePath: options.worktreePath ?? null,
    worktreeMissing: options.worktreeMissing ?? false,
    phase: options.phase ?? null,
    resume: null,
  };
}

function workspace(
  workspaceId: string,
  boards: BoardStatusEntry[],
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
            statusItems: [],
            agent: null,
            zoomed: false,
            bell: false,
            startup: null,
            worktreePath: null,
            worktreeMissing: false,
            phase: null,
            resume: null,
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
            statusItems: [],
            agent: null,
            zoomed: false,
            bell: false,
            startup: null,
            worktreePath: null,
            worktreeMissing: false,
            phase: null,
            resume: null,
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

  test("Board.autoNameは連番より優先し、Board.nameには負ける", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), { autoName: "niwaterm" }),
        board("board-2", leaf("tile-2", ["tab-2"], "tab-2"), {
          name: "roadmap-doc",
          autoName: "niwaterm",
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards.map((b) => b.label)).toEqual(["niwaterm", "roadmap-doc"]);
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
    expect(statusTextOf(items[0]?.boards[0], "builtin:branch")).toBe("main");
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

    expect(statusTextOf(items[0]?.boards[0], "builtin:branch")).toBe("feature/focused");
  });

  test("フェーズ未設定時はphase:null", () => {
    const workspaces = [workspace("ws-1", [board("board-1", leaf("tile-1", ["tab-1"], "tab-1"))])];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1", [
      { id: "review", label: "レビュー", color: "#f9e2af" },
    ]);

    expect(items[0]?.boards[0]?.phase).toBeNull();
  });

  test("候補に載っているフェーズはラベル・配色を引く", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), { phase: "review" }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1", [
      { id: "review", label: "レビュー", color: "#f9e2af" },
    ]);

    expect(items[0]?.boards[0]?.phase).toEqual({
      value: "review",
      label: "レビュー",
      color: "#f9e2af",
    });
  });

  test("候補に無い文字列（CLIで直接設定した値）は値そのものを既定色で出す", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), { phase: "あとで直す" }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1", [
      { id: "review", label: "レビュー", color: null },
    ]);

    expect(items[0]?.boards[0]?.phase).toEqual({
      value: "あとで直す",
      label: "あとで直す",
      color: null,
    });
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

  test("フォーカス中タイルがズーム中の場合、Boardはzoomed:trueになる", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), { zoomedTileId: "tile-1" }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.zoomed).toBe(true);
  });

  test("ズーム中でなければzoomed:falseになる", () => {
    const workspaces = [workspace("ws-1", [board("board-1", leaf("tile-1", ["tab-1"], "tab-1"))])];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.zoomed).toBe(false);
  });

  test("ワークツリーの紐づけと存在チェックの結果がBoard行へそのまま載る", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          worktreePath: "/repo/.worktrees/feat",
          worktreeMissing: true,
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.worktreePath).toBe("/repo/.worktrees/feat");
    expect(items[0]?.boards[0]?.worktreeMissing).toBe(true);
  });

  test("ワークツリーの紐づけが無いBoardはworktreePath:null・worktreeMissing:falseになる", () => {
    const workspaces = [workspace("ws-1", [board("board-1", leaf("tile-1", ["tab-1"], "tab-1"))])];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.worktreePath).toBeNull();
    expect(items[0]?.boards[0]?.worktreeMissing).toBe(false);
  });

  test("グローバル設定由来の起動時レイアウトはprojectRoot:nullで返る", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          startup: { preset: "dev", restoreMode: "layout" },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.startup).toEqual({
      preset: "dev",
      restoreMode: "layout",
      projectRoot: null,
    });
  });

  test("プロジェクトローカル由来の起動時レイアウトはprojectRootがそのまま載る（trust確認の要否判定に使う）", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
          startup: { preset: "dev", restoreMode: "restore", projectRoot: "/repo" },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.startup).toEqual({
      preset: "dev",
      restoreMode: "restore",
      projectRoot: "/repo",
    });
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

describe("Board内の全タブからのagent集約", () => {
  test("フォーカスしていないタイルのエージェント状態も拾う", () => {
    const workspaces = [
      workspace("ws-1", [
        board(
          "board-1",
          split("root", leaf("tile-1", ["tab-1"], "tab-1"), leaf("tile-2", ["tab-2"], "tab-2")),
          {
            focusedTileId: "tile-1",
            tabVars: { "tab-2": { agent: "claude-code", agent_status: "blocked" } },
          },
        ),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent).toEqual({
      agent: "claude-code",
      status: "blocked",
      statusText: null,
    });
  });

  test("同じタイル内の非アクティブタブのエージェント状態も拾う", () => {
    const workspaces = [
      workspace("ws-1", [
        board("board-1", leaf("tile-1", ["tab-1", "tab-2"], "tab-1"), {
          focusedTileId: "tile-1",
          tabVars: { "tab-2": { agent: "claude-code", agent_status: "working" } },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent?.status).toBe("working");
  });

  test("複数エージェントがいる場合はblocked > working > idleの順で最も目立つものを選ぶ", () => {
    const layout = split(
      "root",
      leaf("tile-1", ["tab-1"], "tab-1"),
      split("inner", leaf("tile-2", ["tab-2"], "tab-2"), leaf("tile-3", ["tab-3"], "tab-3")),
    );
    const workspaces = [
      workspace("ws-1", [
        board("board-1", layout, {
          focusedTileId: "tile-1",
          tabVars: {
            "tab-1": { agent: "a-idle", agent_status: "idle" },
            "tab-2": { agent: "b-working", agent_status: "working" },
            "tab-3": { agent: "c-blocked", agent_status: "blocked" },
          },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent?.agent).toBe("c-blocked");
  });

  test("同順位が複数ある場合は代表タブ（フォーカス中タイルのアクティブタブ）を優先する", () => {
    const layout = split(
      "root",
      leaf("tile-1", ["tab-1"], "tab-1"),
      leaf("tile-2", ["tab-2"], "tab-2"),
    );
    const workspaces = [
      workspace("ws-1", [
        board("board-1", layout, {
          focusedTileId: "tile-2",
          tabVars: {
            "tab-1": { agent: "first-in-layout", agent_status: "working" },
            "tab-2": { agent: "representative", agent_status: "working" },
          },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent?.agent).toBe("representative");
  });

  test("代表タブが同順位に含まれない場合はレイアウト上の出現順で先勝ちする", () => {
    const layout = split(
      "root",
      leaf("tile-1", ["tab-1"], "tab-1"),
      leaf("tile-2", ["tab-2"], "tab-2"),
    );
    const workspaces = [
      workspace("ws-1", [
        board("board-1", layout, {
          focusedTileId: "tile-1",
          tabVars: {
            "tab-1": { agent: "focused-idle", agent_status: "idle" },
            "tab-2": { agent: "other-working", agent_status: "working" },
          },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(items[0]?.boards[0]?.agent?.agent).toBe("other-working");
  });

  test("branchは集約せず代表タブの値のみを使う", () => {
    const layout = split(
      "root",
      leaf("tile-1", ["tab-1"], "tab-1"),
      leaf("tile-2", ["tab-2"], "tab-2"),
    );
    const workspaces = [
      workspace("ws-1", [
        board("board-1", layout, {
          focusedTileId: "tile-1",
          tabVars: {
            "tab-1": { branch: "main" },
            "tab-2": { branch: "other", agent: "claude-code", agent_status: "working" },
          },
        }),
      ]),
    ];

    const items = buildSidebarWorkspaceItems(workspaces, "ws-1");

    expect(statusTextOf(items[0]?.boards[0], "builtin:branch")).toBe("main");
    expect(items[0]?.boards[0]?.agent?.agent).toBe("claude-code");
  });
});

describe("buildSidebarWorkspaceItems: ステータスライン（sidebar.boardStatus）", () => {
  const phases = [{ id: "review", label: "レビュー", color: "#f9e2af" }];

  function boardWith(vars: Record<string, string>, phase?: string) {
    return workspace("ws-1", [
      board("board-1", leaf("tile-1", ["tab-1"], "tab-1"), {
        tabVars: { "tab-1": vars },
        phase: phase ?? null,
      }),
    ]);
  }

  function statusItemsOf(vars: Record<string, string>, boardStatus: unknown, phase?: string) {
    const items = buildSidebarWorkspaceItems(
      [boardWith(vars, phase)],
      "ws-1",
      phases,
      normalizeSidebarBoardStatus(boardStatus),
    );
    return items[0]?.boards[0]?.statusItems ?? [];
  }

  test("設定に並べた順で出る", () => {
    const items = statusItemsOf(
      { branch: "main", agent: "claude-code", agent_status_text: "実装中" },
      ["builtin:agent", "builtin:branch", "builtin:phase"],
      "review",
    );

    expect(items.map((item) => item.id)).toEqual([
      "builtin:agent",
      "builtin:branch",
      "builtin:phase",
    ]);
  });

  test("設定から外した項目は出ない", () => {
    const items = statusItemsOf(
      { branch: "main", agent: "claude-code", agent_status_text: "実装中" },
      ["builtin:agent"],
      "review",
    );

    expect(items.map((item) => item.id)).toEqual(["builtin:agent"]);
  });

  test("空配列ならステータスラインを1行も作らない", () => {
    expect(statusItemsOf({ branch: "main" }, [])).toEqual([]);
  });

  test("builtin:branchの既定の接頭辞はon", () => {
    expect(statusItemsOf({ branch: "main" }, ["builtin:branch"])).toEqual([
      { kind: "text", id: "builtin:branch", value: "main", prefix: "on", color: null },
    ]);
  });

  test("接頭辞・文字色の指定はビルトインにも効く", () => {
    expect(
      statusItemsOf({ branch: "main" }, [
        { source: "builtin:branch", prefix: "", color: "#a6e3a1" },
      ]),
    ).toEqual([
      { kind: "text", id: "builtin:branch", value: "main", prefix: "", color: "#a6e3a1" },
    ]);
  });

  test("tab-varは代表タブの変数をそのまま出す", () => {
    expect(
      statusItemsOf({ ticket: "PROJ-123" }, [{ source: "tab-var:ticket", prefix: "#" }]),
    ).toEqual([
      { kind: "text", id: "tab-var:ticket", value: "PROJ-123", prefix: "#", color: null },
    ]);
  });

  test("値が空の項目は行を作らずに詰める", () => {
    const items = statusItemsOf({ branch: "main", ticket: "" }, [
      "tab-var:ticket",
      "builtin:branch",
      "tab-var:unset",
    ]);

    expect(items.map((item) => item.id)).toEqual(["builtin:branch"]);
  });

  test("statusTextが無いエージェントは行を作らない（ドットの色だけで示す）", () => {
    const items = statusItemsOf({ agent: "claude-code", agent_status: "working" }, [
      "builtin:agent",
    ]);

    expect(items).toEqual([]);
  });

  test("フェーズ未設定なら行を作らない", () => {
    expect(statusItemsOf({}, ["builtin:phase"])).toEqual([]);
  });

  test("builtin:phaseは候補で解決したバッジ情報を持つ", () => {
    expect(statusItemsOf({}, ["builtin:phase"], "review")).toEqual([
      {
        kind: "phase",
        id: "builtin:phase",
        phase: { value: "review", label: "レビュー", color: "#f9e2af" },
      },
    ]);
  });
});

describe("sidebarDropIndex", () => {
  test("後ろの行の下へ落とすと、取り除いた分だけ手前のindexになる", () => {
    // [A, B, C] のAをCの下へ → [B, C, A]
    expect(sidebarDropIndex(0, 2, "after")).toBe(2);
  });

  test("手前の行の上へ落とすとそのindexへ入る", () => {
    // [A, B, C] のCをAの上へ → [C, A, B]
    expect(sidebarDropIndex(2, 0, "before")).toBe(0);
  });

  test("並びが変わらない組み合わせはnull", () => {
    // 自分自身の上下と、隣接する相手の「自分側」への挿入は元の並びと同じになる
    expect(sidebarDropIndex(1, 1, "before")).toBeNull();
    expect(sidebarDropIndex(1, 1, "after")).toBeNull();
    expect(sidebarDropIndex(0, 1, "before")).toBeNull();
    expect(sidebarDropIndex(1, 0, "after")).toBeNull();
  });
});

describe("Board行のベル", () => {
  test("フォーカスしていないタイルの非アクティブタブで鳴ったベルも拾う", () => {
    const layout = split(
      "split-1",
      leaf("tile-1", ["tab-1"], "tab-1"),
      leaf("tile-2", ["tab-2", "tab-3"], "tab-2"),
    );
    const workspaces = [
      workspace("ws-1", [
        board("board-1", layout, { focusedTileId: "tile-1", tabVars: { "tab-3": { bell: "1" } } }),
      ]),
    ];

    expect(buildSidebarWorkspaceItems(workspaces, "ws-1")[0]?.boards[0]?.bell).toBe(true);
  });

  test("どのタブにもベルが立っていなければfalse", () => {
    const workspaces = [workspace("ws-1", [board("board-1", leaf("tile-1", ["tab-1"], "tab-1"))])];

    expect(buildSidebarWorkspaceItems(workspaces, "ws-1")[0]?.boards[0]?.bell).toBe(false);
  });
});
