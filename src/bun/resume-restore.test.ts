import { describe, expect, test } from "bun:test";
import type { LayoutPreset } from "@niwaterm/config";
import { applyLayoutPreset } from "./layout-apply";
import type { PersistedState, PersistedTileNode } from "./persistence";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import { listLeaves } from "./tile-layout";
import {
  collectSlotRunningCommands,
  createWorkspaceManager,
  type WorkspaceManager,
  type WorkspaceManagerOptions,
} from "./workspace-manager";

interface FakeSession {
  opts: TerminalSessionOptions;
  /** runCommandWhenReadyで流したコマンド */
  commands: string[];
}

function createFakeSessionFactory() {
  const created: FakeSession[] = [];
  const factory = (opts: TerminalSessionOptions): TerminalSession => {
    const record: FakeSession = { opts, commands: [] };
    created.push(record);
    return {
      write: () => {},
      runCommandWhenReady: (command: string) => record.commands.push(command),
      paste: () => {},
      mouseEvent: () => {},
      resize: () => false,
      setCellSize: () => {},
      setMaxScrollback: () => {},
      scroll: () => {},
      scrollToTop: () => {},
      scrollToBottom: () => {},
      renderState: () => ({
        kind: "terminal",
        html: "",
        cursorX: 0,
        cursorY: 0,
        cursorVisible: true,
        cursorShape: "block",
        viewportPinned: true,
        mouseTracking: false,
        mouseAnyMotion: false,
      }),
      dumpText: () => "",
      getRunningCommand: () => null,
      showNotice: () => {},
      setCallbacks: () => {},
      dispose: () => {},
    } as unknown as TerminalSession;
  };
  return { created, factory };
}

function baseOpts(overrides: Partial<WorkspaceManagerOptions>): WorkspaceManagerOptions {
  return {
    initialCols: 80,
    initialRows: 24,
    onDirty: () => {},
    onAllWorkspacesClosed: () => {},
    ...overrides,
  };
}

function resolvePending(mgr: WorkspaceManager): void {
  for (const entry of mgr.snapshot().workspaces) {
    for (const board of entry.boards) {
      for (const leaf of listLeaves(board.layout)) {
        for (const tabId of leaf.tabIds) mgr.handleResize(tabId, 80, 24, 8, 18);
      }
    }
  }
}

function persistedLayout(state: PersistedState, boardIndex = 0): PersistedTileNode {
  return state.workspaces[0]?.boards[boardIndex]?.layout as PersistedTileNode;
}

function stateWithBoard(
  layout: PersistedTileNode,
  board: {
    resume?: boolean;
    startup?: PersistedState["workspaces"][0]["boards"][0]["startup"];
  } = {},
): PersistedState {
  return {
    version: 3,
    activeWorkspaceIndex: 0,
    workspaces: [{ boards: [{ layout, ...board }], activeBoardIndex: 0 }],
  };
}

describe("実行中のコマンドの記録", () => {
  test("シェル統合が報告したコマンドを保存し、プロンプトへ戻ったら消す", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    resolvePending(mgr);
    const session = created[0] as FakeSession;

    session.opts.onRunningCommandChanged?.("nvim foo.md");
    const leaf = persistedLayout(mgr.serializeForPersistence()) as Extract<
      PersistedTileNode,
      { kind: "leaf" }
    >;
    expect(leaf.tabs[0]).toMatchObject({ kind: "terminal", runningCommand: "nvim foo.md" });

    session.opts.onRunningCommandChanged?.(null);
    const after = persistedLayout(mgr.serializeForPersistence()) as Extract<
      PersistedTileNode,
      { kind: "leaf" }
    >;
    expect(after.tabs[0]).not.toHaveProperty("runningCommand");
  });
});

describe("restoreモードのBoardの打ち直し", () => {
  const layout: PersistedTileNode = {
    kind: "leaf",
    tabs: [{ kind: "terminal", runningCommand: "nvim foo.md" }],
    activeTabIndex: 0,
  };

  test("PTYの起動時に判定し、打ち直すと決まったコマンドを流す", () => {
    const { created, factory } = createFakeSessionFactory();
    const calls: Array<[string, boolean | null]> = [];
    const mgr = createWorkspaceManager(
      baseOpts({
        createSession: factory,
        restoreFrom: stateWithBoard(layout),
        resolveResumeCommand: (command, override) => {
          calls.push([command, override]);
          return command;
        },
      }),
    );
    // 表示されるまで（handleResizeが来るまで）は判定もしない
    expect(calls).toEqual([]);

    resolvePending(mgr);
    expect(calls).toEqual([["nvim foo.md", null]]);
    expect(created[0]?.commands).toEqual(["nvim foo.md"]);
  });

  test("判定がnullなら何も流さない。Boardの手動の切り替えが判定へ渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const calls: Array<boolean | null> = [];
    const mgr = createWorkspaceManager(
      baseOpts({
        createSession: factory,
        restoreFrom: stateWithBoard(layout, { resume: false }),
        resolveResumeCommand: (_command, override) => {
          calls.push(override);
          return null;
        },
      }),
    );
    resolvePending(mgr);
    expect(calls).toEqual([false]);
    expect(created[0]?.commands).toEqual([]);
  });

  test("一度も表示しないまま保存しても、前回の実行中コマンドを持ち越す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, restoreFrom: stateWithBoard(layout) }),
    );
    const leaf = persistedLayout(mgr.serializeForPersistence()) as Extract<
      PersistedTileNode,
      { kind: "leaf" }
    >;
    expect(leaf.tabs[0]).toMatchObject({ runningCommand: "nvim foo.md" });
  });
});

describe("Boardの手動の切り替え", () => {
  test("設定・解除でき、保存・一覧に載る", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const boardId = mgr.snapshot().workspace.activeBoardId as string;

    expect(mgr.getBoardResume(boardId)).toBeNull();
    expect(mgr.setBoardResume(boardId, false)).toBe(true);
    expect(mgr.getBoardResume(boardId)).toBe(false);
    expect(mgr.serializeForPersistence().workspaces[0]?.boards[0]?.resume).toBe(false);
    expect(mgr.listWorkspaces()[0]?.boards[0]?.resume).toBe(false);

    mgr.setBoardResume(boardId, null);
    expect(mgr.serializeForPersistence().workspaces[0]?.boards[0]).not.toHaveProperty("resume");
  });

  test("存在しないBoardはfalse", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.setBoardResume("board-missing", true)).toBe(false);
  });
});

describe("collectSlotRunningCommands", () => {
  test("layoutSlotと実行中コマンドの両方を持つタブだけを集める", () => {
    expect(
      collectSlotRunningCommands({
        kind: "split",
        direction: "row",
        ratio: 0.5,
        first: {
          kind: "leaf",
          tabs: [
            { kind: "terminal", layoutSlot: "first.tabs.0", runningCommand: "nvim" },
            { kind: "terminal", layoutSlot: "first.tabs.1" },
            { kind: "terminal", runningCommand: "htop" },
          ],
          activeTabIndex: 0,
        },
        second: {
          kind: "leaf",
          tabs: [{ kind: "terminal", layoutSlot: "second.tabs.0", runningCommand: "claude" }],
          activeTabIndex: 0,
        },
      }),
    ).toEqual({ "first.tabs.0": "nvim", "second.tabs.0": "claude" });
  });
});

describe("layoutモードのBoardの打ち直し", () => {
  const preset: LayoutPreset = {
    layout: {
      kind: "split",
      orientation: "horizontal",
      first: { kind: "tile", tabs: [{ command: "nvim", resume: true }] },
      second: { kind: "tile", tabs: [{ command: "bun run dev" }] },
    },
  };

  function restoreLayoutBoard(boardResume?: boolean) {
    const { created, factory } = createFakeSessionFactory();
    const layout: PersistedTileNode = {
      kind: "split",
      direction: "row",
      ratio: 0.5,
      first: {
        kind: "leaf",
        tabs: [{ kind: "terminal", layoutSlot: "first.tabs.0", runningCommand: "nvim foo.md" }],
        activeTabIndex: 0,
      },
      second: {
        kind: "leaf",
        tabs: [{ kind: "terminal", layoutSlot: "second.tabs.0", runningCommand: "htop" }],
        activeTabIndex: 0,
      },
    };
    const mgr = createWorkspaceManager(
      baseOpts({
        createSession: factory,
        restoreFrom: stateWithBoard(layout, {
          startup: { preset: "dev", restoreMode: "layout" },
          ...(boardResume !== undefined ? { resume: boardResume } : {}),
        }),
      }),
    );
    return { created, mgr };
  }

  test("listStartupLayoutBoardsが前回の実行中コマンドをslotごとに返す", () => {
    const { mgr } = restoreLayoutBoard();
    expect(mgr.listStartupLayoutBoards()[0]).toMatchObject({
      resumeOverride: null,
      resumeCommands: { "first.tabs.0": "nvim foo.md", "second.tabs.0": "htop" },
    });
  });

  test("resumeを付けたタブだけ、許可されたコマンドをcommandより優先して打ち直す", () => {
    const { created, mgr } = restoreLayoutBoard();
    const [entry] = mgr.listStartupLayoutBoards();
    if (!entry) throw new Error("no startup board");
    const result = applyLayoutPreset(mgr, [], preset, "replace", entry.boardId, {
      resume: {
        commands: entry.resumeCommands,
        override: entry.resumeOverride,
        allow: ["nvim", "htop"],
      },
    });
    expect(result.ok).toBe(true);
    resolvePending(mgr);
    const commands = created.map((s) => s.commands).filter((c) => c.length > 0);
    expect(commands).toEqual([["nvim foo.md"], ["bun run dev"]]);
  });

  test("許可されていなければcommandを実行する", () => {
    const { created, mgr } = restoreLayoutBoard();
    const [entry] = mgr.listStartupLayoutBoards();
    if (!entry) throw new Error("no startup board");
    applyLayoutPreset(mgr, [], preset, "replace", entry.boardId, {
      resume: { commands: entry.resumeCommands, override: entry.resumeOverride, allow: [] },
    });
    resolvePending(mgr);
    const commands = created.map((s) => s.commands).filter((c) => c.length > 0);
    expect(commands).toEqual([["nvim"], ["bun run dev"]]);
  });

  test("Boardの手動の切り替えがオンなら、resumeを付けていないタブも打ち直す", () => {
    const { created, mgr } = restoreLayoutBoard(true);
    const [entry] = mgr.listStartupLayoutBoards();
    if (!entry) throw new Error("no startup board");
    applyLayoutPreset(mgr, [], preset, "replace", entry.boardId, {
      resume: {
        commands: entry.resumeCommands,
        override: entry.resumeOverride,
        allow: ["nvim", "htop"],
      },
    });
    resolvePending(mgr);
    const commands = created.map((s) => s.commands).filter((c) => c.length > 0);
    expect(commands).toEqual([["nvim foo.md"], ["htop"]]);
  });

  test("組み直したタブにslotが付き、表示前に終了しても打ち直すコマンドを持ち越す", () => {
    const { mgr } = restoreLayoutBoard();
    const [entry] = mgr.listStartupLayoutBoards();
    if (!entry) throw new Error("no startup board");
    applyLayoutPreset(mgr, [], preset, "replace", entry.boardId, {
      resume: { commands: entry.resumeCommands, override: null, allow: ["nvim"] },
    });
    const saved = persistedLayout(mgr.serializeForPersistence());
    expect(collectSlotRunningCommands(saved)).toEqual({ "first.tabs.0": "nvim foo.md" });
    const leaves = saved.kind === "split" ? [saved.first, saved.second] : [saved];
    expect(
      leaves.map((l) => {
        const tab = (l as Extract<PersistedTileNode, { kind: "leaf" }>).tabs[0];
        return tab?.kind === "terminal" ? tab.layoutSlot : undefined;
      }),
    ).toEqual(["first.tabs.0", "second.tabs.0"]);
    // 前回分は一度取り出したら消える（2回目の組み直しへ持ち込まない）
    expect(mgr.listStartupLayoutBoards()[0]?.resumeCommands).toEqual({});
  });
});
