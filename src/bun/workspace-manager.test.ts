import type { BoardNaming } from "@niwaterm/config";
import { describe, expect, test } from "bun:test";
import type { PersistedState } from "./persistence";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import { listLeaves, type TileLeaf, type TileNode } from "./tile-layout";
import {
  createWorkspaceManager,
  type WorkspaceManager,
  type WorkspaceManagerOptions,
} from "./workspace-manager";

/**
 * PTY起動はwebview側の実測cols/rowsが届く（handleResize）まで保留される設計。
 * テストではcreateWorkspaceManager/newTab/splitTile等の直後にこれを呼び、pending中の
 * 全ワークスペース・全Boardの全タブへダミーのcols/rowsを送ってPTY起動を確定させる
 */
function resolvePending(mgr: WorkspaceManager, cols = 80, rows = 24): void {
  for (const entry of mgr.snapshot().workspaces) {
    for (const board of entry.boards) {
      for (const leaf of listLeaves(board.layout)) {
        for (const tabId of leaf.tabIds) {
          mgr.handleResize(tabId, cols, rows, 8, 18);
        }
      }
    }
  }
}

interface FakeSessionRecord {
  opts: TerminalSessionOptions;
  disposed: boolean;
}

function createFakeSessionFactory() {
  const created: FakeSessionRecord[] = [];
  const factory = (opts: TerminalSessionOptions): TerminalSession => {
    const record: FakeSessionRecord = { opts, disposed: false };
    created.push(record);
    return {
      write: () => {},
      runCommandWhenReady: () => {},
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
      dispose: () => {
        record.disposed = true;
      },
    };
  };
  return { created, factory };
}

function baseOpts(
  overrides: Partial<WorkspaceManagerOptions> & {
    createSession: WorkspaceManagerOptions["createSession"];
  },
): WorkspaceManagerOptions {
  return {
    initialCols: 80,
    initialRows: 24,
    onDirty: () => {},
    onAllWorkspacesClosed: () => {},
    ...overrides,
  };
}

describe("getDefaultShellの配線", () => {
  test("getDefaultShellが返す値がworkspace.tsまで届き、初期タブのセッションへshellとして渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }),
    );
    resolvePending(mgr);
    expect(created[0]?.opts.shell).toBe("/bin/bash");
  });

  test("newTabにshellOverrideを渡すとworkspace.tsまで届き、そのタブのセッションへ優先して渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }),
    );
    resolvePending(mgr);
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.newTab(tileId, "wsl.exe -d Ubuntu");
    expect(created[1]?.opts.shell).toBe("wsl.exe -d Ubuntu");
  });
});

describe("createWorkspaceManager", () => {
  test("初期状態は単一ワークスペース・単一タイル・単一タブ", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const snap = mgr.snapshot();
    expect(snap.workspaceIds).toEqual([snap.activeWorkspaceId]);
    expect(snap.workspace.board.layout.kind).toBe("leaf");
  });

  test("tile/tab/workspaceのidは複数ワークスペース間で衝突しない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    mgr.newWorkspace();
    mgr.newWorkspace();
    const ids = new Set<string>();
    for (const wid of mgr.snapshot().workspaceIds) {
      mgr.switchWorkspace(wid);
      const layout = mgr.snapshot().workspace.board.layout as TileLeaf;
      expect(ids.has(wid)).toBe(false);
      expect(ids.has(layout.id)).toBe(false);
      expect(ids.has(layout.activeTabId)).toBe(false);
      ids.add(wid);
      ids.add(layout.id);
      ids.add(layout.activeTabId);
    }
  });
});

describe("newWorkspace / switchWorkspace / closeWorkspace", () => {
  test("newWorkspaceで新規ワークスペースが増え、アクティブになり、新規workspaceIdを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const newId = mgr.newWorkspace();
    const snap = mgr.snapshot();
    expect(snap.workspaceIds.length).toBe(2);
    expect(snap.activeWorkspaceId).not.toBe(firstId);
    expect(newId).toBe(snap.activeWorkspaceId);
  });

  test("switchWorkspaceでアクティブなワークスペースの描画データが切り替わり、trueを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;
    expect(mgr.switchWorkspace(firstId)).toBe(true);
    expect(mgr.snapshot().activeWorkspaceId).toBe(firstId);
    expect(mgr.switchWorkspace(secondId)).toBe(true);
    expect(mgr.snapshot().activeWorkspaceId).toBe(secondId);
  });

  test("存在しないworkspaceIdへのswitchWorkspaceは無視されfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const activeId = mgr.snapshot().activeWorkspaceId;
    expect(mgr.switchWorkspace("not-found")).toBe(false);
    expect(mgr.snapshot().activeWorkspaceId).toBe(activeId);
  });

  test("closeWorkspaceで非アクティブなワークスペースを削除でき、そのセッションもdisposeされる", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;
    resolvePending(mgr);
    mgr.switchWorkspace(firstId);

    expect(mgr.closeWorkspace(secondId)).toEqual({ ok: true });

    expect(mgr.snapshot().workspaceIds).toEqual([firstId]);
    expect(created[1]?.disposed).toBe(true);
  });

  test("closeWorkspaceでアクティブなワークスペースを閉じると別のワークスペースへ切り替わる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;

    mgr.closeWorkspace(secondId);

    expect(mgr.snapshot().activeWorkspaceId).toBe(firstId);
  });

  test("存在しないworkspaceIdへのcloseWorkspaceはnot-found理由を返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    mgr.newWorkspace();
    expect(mgr.closeWorkspace("not-found")).toEqual({ ok: false, reason: "not-found" });
    expect(mgr.snapshot().workspaceIds.length).toBe(2);
  });

  test("最後の1つのワークスペースはcloseWorkspaceしても閉じられず、last-workspace理由を返す（誤操作防止）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const onlyId = mgr.snapshot().activeWorkspaceId;
    expect(mgr.closeWorkspace(onlyId)).toEqual({ ok: false, reason: "last-workspace" });
    expect(mgr.snapshot().workspaceIds).toEqual([onlyId]);
  });
});

describe("Board操作", () => {
  test("newBoardで指定workspaceに新規Boardが増え、アクティブになり、新規boardIdを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId;

    const newBoardId = mgr.newBoard(workspaceId);

    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.map((b) => b.boardId)).toEqual([firstBoardId, newBoardId]);
    expect(entry?.activeBoardId).toBe(newBoardId);
  });

  test("newBoard(activate=false)はBoardを増やすがアクティブにしない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId;

    const newBoardId = mgr.newBoard(workspaceId, undefined, { activate: false });

    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.map((b) => b.boardId)).toEqual([firstBoardId, newBoardId]);
    expect(entry?.activeBoardId).toBe(firstBoardId);
  });

  test("newBoardのworktreePathは一覧・永続化に載り、ラウンドトリップしても残る", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId;

    const boardId = mgr.newBoard(workspaceId, undefined, { worktreePath: "/repo/work/feature" });

    const boards = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId)?.boards;
    expect(boards?.find((b) => b.boardId === boardId)?.worktreePath).toBe("/repo/work/feature");
    // worktreeコマンド由来でないBoardには付かない
    expect(boards?.find((b) => b.boardId === firstBoardId)?.worktreePath).toBeNull();

    const persisted = mgr.serializeForPersistence();
    expect(persisted.workspaces[0]?.boards.map((b) => b.worktreePath)).toEqual([
      undefined,
      "/repo/work/feature",
    ]);
    const restored = createWorkspaceManager(
      baseOpts({ createSession: factory, restoreFrom: persisted }),
    );
    expect(restored.serializeForPersistence()).toEqual(persisted);
  });

  test("setBoardWorktreePathで紐づけを張り替えられ、nullで解除できる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const boardId = mgr.listWorkspaces()[0]?.activeBoardId as string;

    expect(mgr.setBoardWorktreePath(boardId, "/repo/work/feature")).toBe(true);
    expect(mgr.getBoardWorktreePath(boardId)).toBe("/repo/work/feature");

    expect(mgr.setBoardWorktreePath(boardId, "/repo/work/other")).toBe(true);
    expect(mgr.listWorkspaces()[0]?.boards[0]?.worktreePath).toBe("/repo/work/other");
    // 張り替えた値も永続化に載る
    expect(mgr.serializeForPersistence().workspaces[0]?.boards[0]?.worktreePath).toBe(
      "/repo/work/other",
    );

    expect(mgr.setBoardWorktreePath(boardId, null)).toBe(true);
    expect(mgr.getBoardWorktreePath(boardId)).toBeNull();
    expect(mgr.serializeForPersistence().workspaces[0]?.boards[0]?.worktreePath).toBeUndefined();
  });

  test("setBoardPhaseでフェーズを付け替えられ、nullで解除できる（永続化にも載る）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const boardId = mgr.listWorkspaces()[0]?.activeBoardId as string;

    expect(mgr.setBoardPhase(boardId, "plan")).toBe(true);
    expect(mgr.getBoardPhase(boardId)).toBe("plan");
    expect(mgr.listWorkspaces()[0]?.boards[0]?.phase).toBe("plan");
    expect(mgr.serializeForPersistence().workspaces[0]?.boards[0]?.phase).toBe("plan");

    expect(mgr.setBoardPhase(boardId, "review")).toBe(true);
    expect(mgr.listWorkspaces()[0]?.boards[0]?.phase).toBe("review");

    expect(mgr.setBoardPhase(boardId, null)).toBe(true);
    expect(mgr.getBoardPhase(boardId)).toBeNull();
    expect(mgr.serializeForPersistence().workspaces[0]?.boards[0]?.phase).toBeUndefined();
  });

  test("空白だけのフェーズは解除として扱い、前後の空白は落とす", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const boardId = mgr.listWorkspaces()[0]?.activeBoardId as string;

    mgr.setBoardPhase(boardId, "  レビュー待ち  ");
    expect(mgr.getBoardPhase(boardId)).toBe("レビュー待ち");

    mgr.setBoardPhase(boardId, "   ");
    expect(mgr.getBoardPhase(boardId)).toBeNull();
  });

  test("フェーズは保存・復元でラウンドトリップする", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    mgr.setBoardPhase(mgr.listWorkspaces()[0]?.activeBoardId as string, "implement");
    const persisted = mgr.serializeForPersistence();

    const restored = createWorkspaceManager(
      baseOpts({ createSession: factory, restoreFrom: persisted }),
    );
    expect(restored.listWorkspaces()[0]?.boards[0]?.phase).toBe("implement");
  });

  test("存在しないboardIdへのsetBoardPhaseはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.setBoardPhase("not-found", "plan")).toBe(false);
  });

  test("存在しないboardIdへのsetBoardWorktreePathはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.setBoardWorktreePath("not-found", "/repo")).toBe(false);
  });

  test("isWorktreeMissingの判定結果が一覧のworktreeMissingへ載る（紐づけの無いBoardは常にfalse）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, isWorktreeMissing: (path) => path === "/gone" }),
    );
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId;
    const goneId = mgr.newBoard(workspaceId, undefined, { worktreePath: "/gone" });
    const liveId = mgr.newBoard(workspaceId, undefined, { worktreePath: "/here" });

    const boards = mgr.listWorkspaces()[0]?.boards;
    expect(boards?.find((b) => b.boardId === goneId)?.worktreeMissing).toBe(true);
    expect(boards?.find((b) => b.boardId === liveId)?.worktreeMissing).toBe(false);
    expect(boards?.find((b) => b.boardId === firstBoardId)?.worktreeMissing).toBe(false);
  });

  test("Boardを閉じるとworktreePathの紐づけも消える", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const boardId = mgr.newBoard(workspaceId, undefined, { worktreePath: "/repo/work/feature" });

    expect(mgr.closeBoard(boardId as string)).toEqual({ ok: true });

    expect(mgr.serializeForPersistence().workspaces[0]?.boards).toHaveLength(1);
    expect(mgr.listWorkspaces()[0]?.boards[0]?.worktreePath).toBeNull();
  });

  test("存在しないworkspaceIdへのnewBoardはnullを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.newBoard("not-found")).toBeNull();
  });

  test("switchBoardで対象BoardがactiveBoardIdになり、trueを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    const secondBoardId = mgr.newBoard(workspaceId) as string;

    expect(mgr.switchBoard(firstBoardId)).toBe(true);
    expect(mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId)?.activeBoardId).toBe(
      firstBoardId,
    );
    expect(mgr.switchBoard(secondBoardId)).toBe(true);
    expect(mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId)?.activeBoardId).toBe(
      secondBoardId,
    );
  });

  test("存在しないboardIdへのswitchBoardは無視されfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.switchBoard("not-found")).toBe(false);
  });

  test("closeBoardで非アクティブなBoardを削除でき、{ok: true}を返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    mgr.newBoard(workspaceId);

    expect(mgr.closeBoard(firstBoardId)).toEqual({ ok: true });

    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.map((b) => b.boardId)).not.toContain(firstBoardId);
  });

  test("closeBoardでアクティブなBoardを閉じると別のBoardへ切り替わる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    const secondBoardId = mgr.newBoard(workspaceId) as string;

    mgr.closeBoard(secondBoardId);

    expect(mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId)?.activeBoardId).toBe(
      firstBoardId,
    );
  });

  test("ワークスペースが1つだけなら、最後のBoardは閉じられずlast-board理由を返す（誤操作防止）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const onlyBoardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    expect(mgr.closeBoard(onlyBoardId)).toEqual({ ok: false, reason: "last-board" });
  });

  test("他にワークスペースがあれば、最後のBoardを閉じてBoard 0個のワークスペースを残せる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const secondId = mgr.newWorkspace();
    const onlyBoardId = mgr.listWorkspaces().find((e) => e.workspaceId === secondId)
      ?.activeBoardId as string;

    expect(mgr.closeBoard(onlyBoardId)).toEqual({ ok: true });

    expect(mgr.snapshot().workspaceIds).toEqual([firstId, secondId]);
    expect(mgr.listWorkspaces().find((e) => e.workspaceId === secondId)?.activeBoardId).toBeNull();
    expect(mgr.snapshot().workspace.board).toBeNull();
  });

  test("存在しないboardIdへのcloseBoardはnot-found理由を返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.closeBoard("not-found")).toEqual({ ok: false, reason: "not-found" });
  });

  test("setBoardNameで名前を設定するとlistWorkspaces()のboards[].nameへ反映される", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const boardId = mgr.listWorkspaces()[0]?.activeBoardId as string;

    expect(mgr.setBoardName(boardId, "repoA")).toBe(true);

    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.find((b) => b.boardId === boardId)?.name).toBe("repoA");
  });

  test("setBoardNameに空文字列（trim後）を渡すとnameがnullへリセットされる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const boardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    mgr.setBoardName(boardId, "repoA");

    mgr.setBoardName(boardId, "  ");

    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.find((b) => b.boardId === boardId)?.name).toBeNull();
  });

  test("存在しないboardIdへのsetBoardNameはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.setBoardName("not-found", "repoA")).toBe(false);
  });
});

describe("Board名の自動命名(board.naming)", () => {
  function autoNamesOf(mgr: WorkspaceManager): (string | null)[] {
    return mgr.listWorkspaces()[0]?.boards.map((board) => board.autoName) ?? [];
  }

  function activeTabIdOf(mgr: WorkspaceManager): string {
    return (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
  }

  test("既定(directory)はBoardを開いたcwdのディレクトリ名が自動名になる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, initialCwd: "/home/eetann/ghq/niwaterm" }),
    );
    mgr.newBoard(mgr.snapshot().activeWorkspaceId, "/home/eetann/docs/roadmap");

    expect(autoNamesOf(mgr)).toEqual(["niwaterm", "roadmap"]);
  });

  test("directoryはBoardを開いた後にcwdが変わっても自動名を変えない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({
        createSession: factory,
        initialCwd: "/home/eetann/ghq/niwaterm",
        getBoardNaming: () => "directory",
      }),
    );
    mgr.setTabVar(activeTabIdOf(mgr), "cwd", "/home/eetann/docs/roadmap");

    expect(autoNamesOf(mgr)).toEqual(["niwaterm"]);
  });

  test("cwdを指定せず開いたBoardは、タブがcwdを報告した時点でdirectoryの名前が決まる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, getBoardNaming: () => "directory" }),
    );
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    mgr.newBoard(workspaceId);
    // どこで起動したか分からない間は名前を決められない（表示側が連番へフォールバックする）
    expect(autoNamesOf(mgr)[1]).toBeNull();

    // newBoardで作ったBoardがアクティブなので、そのタブがcwdを報告してくる
    const tabId = activeTabIdOf(mgr);
    mgr.setTabVar(tabId, "cwd", "/home/eetann/ghq/niwaterm");
    expect(autoNamesOf(mgr)[1]).toBe("niwaterm");

    // 一度決まれば以後のcdでは変わらない
    mgr.setTabVar(tabId, "cwd", "/home/eetann/docs/roadmap");
    expect(autoNamesOf(mgr)[1]).toBe("niwaterm");
  });

  test("directory-followはフォーカス中タブのcwdへ追従する", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({
        createSession: factory,
        initialCwd: "/home/eetann/ghq/niwaterm",
        getBoardNaming: () => "directory-follow",
      }),
    );
    mgr.setTabVar(activeTabIdOf(mgr), "cwd", "/home/eetann/docs/roadmap");

    expect(autoNamesOf(mgr)).toEqual(["roadmap"]);
  });

  test("sequentialは空いている番号を使い、並び替えても番号は動かない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, getBoardNaming: () => "sequential" }),
    );
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const second = mgr.newBoard(workspaceId);
    mgr.newBoard(workspaceId);
    expect(autoNamesOf(mgr)).toEqual(["Board 1", "Board 2", "Board 3"]);

    // 並び替えで表示順が変わっても、付いている番号はそのまま
    mgr.moveBoard(second as string, 0);
    expect(autoNamesOf(mgr)).toEqual(["Board 2", "Board 1", "Board 3"]);

    // 閉じて空いた番号は次のBoardが引き継ぐ
    mgr.closeBoard(second as string);
    mgr.newBoard(workspaceId);
    expect(autoNamesOf(mgr)).toEqual(["Board 1", "Board 3", "Board 2"]);
  });

  test("ユーザーが付けた名前は自動名より優先され、空文字で戻すと自動名が付け直される", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, initialCwd: "/home/eetann/ghq/niwaterm" }),
    );
    const boardId = mgr.listWorkspaces()[0]?.activeBoardId as string;

    mgr.setBoardName(boardId, "レビュー待ち");
    expect(mgr.listWorkspaces()[0]?.boards[0]?.name).toBe("レビュー待ち");
    // 明示的な名前が付いている間は自動名を持たない
    expect(autoNamesOf(mgr)).toEqual([null]);

    mgr.setTabVar(activeTabIdOf(mgr), "cwd", "/home/eetann/docs/roadmap");
    mgr.setBoardName(boardId, "");
    expect(mgr.listWorkspaces()[0]?.boards[0]?.name).toBeNull();
    // 開いた時点のcwdはもう分からないので、今フォーカスしているタブのcwdで付け直す
    expect(autoNamesOf(mgr)).toEqual(["roadmap"]);
  });

  test("明示的な名前が付いたBoardは連番を消費せず、名前を消すと空き番号が付く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, getBoardNaming: () => "sequential" }),
    );
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const named = mgr.newBoard(workspaceId, undefined, { name: "feat/naming" }) as string;
    mgr.newBoard(workspaceId);
    expect(autoNamesOf(mgr)).toEqual(["Board 1", null, "Board 2"]);

    mgr.setBoardName(named, "");
    expect(autoNamesOf(mgr)).toEqual(["Board 1", "Board 3", "Board 2"]);
  });

  test("refreshBoardAutoNamesで方式の切り替えが既存のBoardへ反映される", () => {
    const { factory } = createFakeSessionFactory();
    let naming: BoardNaming = "directory";
    const mgr = createWorkspaceManager(
      baseOpts({
        createSession: factory,
        initialCwd: "/home/eetann/ghq/niwaterm",
        getBoardNaming: () => naming,
      }),
    );
    mgr.newBoard(mgr.snapshot().activeWorkspaceId, "/home/eetann/docs/roadmap");

    naming = "sequential";
    mgr.refreshBoardAutoNames();

    expect(autoNamesOf(mgr)).toEqual(["Board 1", "Board 2"]);
  });

  test("自動名は永続化され、復元時に付け直さない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, initialCwd: "/home/eetann/ghq/niwaterm" }),
    );
    const persisted = mgr.serializeForPersistence();
    expect(persisted.workspaces[0]?.boards[0]?.autoName).toBe("niwaterm");

    // 保存した値がそのまま使われることを、今のcwdからは導けない名前で確かめる
    const board = persisted.workspaces[0]?.boards[0];
    if (board) board.autoName = "保存した自動名";
    const restored = createWorkspaceManager(
      baseOpts({ createSession: factory, restoreFrom: persisted }),
    );

    expect(autoNamesOf(restored)).toEqual(["保存した自動名"]);
  });
});

describe("moveBoard", () => {
  function createThreeBoards() {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    const secondId = mgr.newBoard(workspaceId) as string;
    const thirdId = mgr.newBoard(workspaceId) as string;
    const boardIds = () =>
      mgr
        .listWorkspaces()
        .find((e) => e.workspaceId === workspaceId)
        ?.boards.map((b) => b.boardId);
    return { mgr, workspaceId, firstId, secondId, thirdId, boardIds };
  }

  test("指定したindexへ移動する（間のBoardは詰められる）", () => {
    const { mgr, firstId, secondId, thirdId, boardIds } = createThreeBoards();
    expect(mgr.moveBoard(firstId, 2)).toBe(true);
    expect(boardIds()).toEqual([secondId, thirdId, firstId]);
  });

  test("末尾から先頭へも移動できる", () => {
    const { mgr, firstId, secondId, thirdId, boardIds } = createThreeBoards();
    expect(mgr.moveBoard(thirdId, 0)).toBe(true);
    expect(boardIds()).toEqual([thirdId, firstId, secondId]);
  });

  test("範囲外のindexは先頭・末尾へクランプする", () => {
    const { mgr, firstId, secondId, thirdId, boardIds } = createThreeBoards();
    expect(mgr.moveBoard(firstId, 99)).toBe(true);
    expect(boardIds()).toEqual([secondId, thirdId, firstId]);
    expect(mgr.moveBoard(firstId, -5)).toBe(true);
    expect(boardIds()).toEqual([firstId, secondId, thirdId]);
  });

  test("アクティブなBoardは変わらない", () => {
    const { mgr, workspaceId, firstId, thirdId } = createThreeBoards();
    mgr.moveBoard(firstId, 2);
    expect(mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId)?.activeBoardId).toBe(
      thirdId,
    );
  });

  test("存在しないboardId・数値でないindexはfalseで順序は変わらない", () => {
    const { mgr, firstId, secondId, thirdId, boardIds } = createThreeBoards();
    expect(mgr.moveBoard("not-found", 0)).toBe(false);
    expect(mgr.moveBoard(firstId, Number.NaN)).toBe(false);
    expect(boardIds()).toEqual([firstId, secondId, thirdId]);
  });

  test("moveBoardByは相対位置へ移動し、端では何もせずtrueを返す", () => {
    const { mgr, firstId, secondId, thirdId, boardIds } = createThreeBoards();
    expect(mgr.moveBoardBy(thirdId, -1)).toBe(true);
    expect(boardIds()).toEqual([firstId, thirdId, secondId]);
    expect(mgr.moveBoardBy(firstId, -1)).toBe(true);
    expect(boardIds()).toEqual([firstId, thirdId, secondId]);
  });

  test("moveBoardByは存在しないboardIdでfalse", () => {
    const { mgr } = createThreeBoards();
    expect(mgr.moveBoardBy("not-found", 1)).toBe(false);
  });

  test("別ワークスペースのBoardの並びには影響しない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstWs = mgr.snapshot().activeWorkspaceId;
    const firstWsBoardA = mgr.listWorkspaces()[0]?.activeBoardId as string;
    const firstWsBoardB = mgr.newBoard(firstWs) as string;
    mgr.newWorkspace();
    const secondWs = mgr.snapshot().activeWorkspaceId;
    const secondWsBoardA = mgr.listWorkspaces()[1]?.activeBoardId as string;
    const secondWsBoardB = mgr.newBoard(secondWs) as string;

    expect(mgr.moveBoard(secondWsBoardB, 0)).toBe(true);

    const entries = mgr.listWorkspaces();
    expect(entries[0]?.boards.map((b) => b.boardId)).toEqual([firstWsBoardA, firstWsBoardB]);
    expect(entries[1]?.boards.map((b) => b.boardId)).toEqual([secondWsBoardB, secondWsBoardA]);
  });

  test("並び替えた順序は永続化データへ反映される", () => {
    const { mgr, firstId, secondId, thirdId } = createThreeBoards();
    // PersistedBoardはboardIdを持たないため、名前で並びを見分ける
    mgr.setBoardName(firstId, "first");
    mgr.setBoardName(secondId, "second");
    mgr.setBoardName(thirdId, "third");

    mgr.moveBoard(firstId, 2);

    const persisted = mgr.serializeForPersistence().workspaces[0];
    expect(persisted?.boards.map((b) => b.name)).toEqual(["second", "third", "first"]);
    // activeBoardIndexも移動後のorderを基準に振り直される
    expect(persisted?.activeBoardIndex).toBe(1);
  });
});

describe("moveBoardToWorkspace", () => {
  /** ワークスペースAに2つ、ワークスペースBに1つBoardがある状態を作る */
  function createTwoWorkspaces() {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const wsA = mgr.snapshot().activeWorkspaceId;
    const boardA1 = mgr.listWorkspaces()[0]?.activeBoardId as string;
    const boardA2 = mgr.newBoard(wsA) as string;
    mgr.newWorkspace();
    const wsB = mgr.snapshot().activeWorkspaceId;
    const boardB1 = mgr.listWorkspaces()[1]?.activeBoardId as string;
    mgr.switchWorkspace(wsA);
    resolvePending(mgr);
    const boardIdsOf = (workspaceId: string) =>
      mgr
        .listWorkspaces()
        .find((e) => e.workspaceId === workspaceId)
        ?.boards.map((b) => b.boardId);
    return { mgr, created, wsA, wsB, boardA1, boardA2, boardB1, boardIdsOf };
  }

  test("Boardが移動先ワークスペースの末尾へ移り、移動元からは消える", () => {
    const { mgr, wsA, wsB, boardA1, boardA2, boardB1, boardIdsOf } = createTwoWorkspaces();
    expect(mgr.moveBoardToWorkspace(boardA2, wsB)).toEqual({ ok: true });
    expect(boardIdsOf(wsA)).toEqual([boardA1]);
    expect(boardIdsOf(wsB)).toEqual([boardB1, boardA2]);
  });

  test("toIndexで移動先の挿入位置を指定できる（範囲外は末尾へクランプ）", () => {
    const { mgr, wsB, boardA2, boardB1, boardIdsOf } = createTwoWorkspaces();
    mgr.moveBoardToWorkspace(boardA2, wsB, 0);
    expect(boardIdsOf(wsB)).toEqual([boardA2, boardB1]);
  });

  test("Board名・worktreePath・フェーズの紐づけも一緒に移る", () => {
    const { mgr, wsA, wsB } = createTwoWorkspaces();
    const boardA3 = mgr.newBoard(wsA, undefined, { worktreePath: "/repo/work/feature" }) as string;
    mgr.setBoardName(boardA3, "feat/x");
    mgr.setBoardPhase(boardA3, "review");

    mgr.moveBoardToWorkspace(boardA3, wsB);

    const moved = mgr
      .listWorkspaces()
      .find((e) => e.workspaceId === wsB)
      ?.boards.find((b) => b.boardId === boardA3);
    expect(moved?.name).toBe("feat/x");
    expect(moved?.worktreePath).toBe("/repo/work/feature");
    expect(moved?.phase).toBe("review");
  });

  test("移動してもタブのセッションは作り直されない（PTYごと移る）", () => {
    const { mgr, created, wsB, boardA2 } = createTwoWorkspaces();
    const before = created.length;
    mgr.moveBoardToWorkspace(boardA2, wsB);
    expect(created.length).toBe(before);
    expect(created.some((c) => c.disposed)).toBe(false);
  });

  test("アクティブなBoardは移動元・移動先とも変わらない", () => {
    const { mgr, wsA, wsB, boardA1, boardA2, boardB1 } = createTwoWorkspaces();
    // newBoardは作ったBoardをアクティブにするため、移動前のwsAのアクティブはboardA2
    mgr.switchBoard(boardA1);
    mgr.moveBoardToWorkspace(boardA2, wsB);
    const entries = mgr.listWorkspaces();
    expect(entries.find((e) => e.workspaceId === wsA)?.activeBoardId).toBe(boardA1);
    expect(entries.find((e) => e.workspaceId === wsB)?.activeBoardId).toBe(boardB1);
  });

  test("アクティブなBoardを移すと、移動元は残りのBoardへ切り替わる", () => {
    const { mgr, wsA, wsB, boardA1, boardA2 } = createTwoWorkspaces();
    mgr.moveBoardToWorkspace(boardA2, wsB);
    expect(mgr.listWorkspaces().find((e) => e.workspaceId === wsA)?.activeBoardId).toBe(boardA1);
  });

  test("移動元の最後のBoardを移しても、そのワークスペースはBoard 0個のまま残る", () => {
    const { mgr, wsA, wsB, boardA1, boardA2, boardIdsOf } = createTwoWorkspaces();
    mgr.moveBoardToWorkspace(boardA2, wsB);
    expect(mgr.moveBoardToWorkspace(boardA1, wsB)).toEqual({ ok: true });
    expect(mgr.snapshot().workspaceIds).toEqual([wsA, wsB]);
    expect(boardIdsOf(wsA)).toEqual([]);
  });

  test("表示中のワークスペースが空になっても切り替わらない（空のまま表示する）", () => {
    const { mgr, wsA, wsB, boardA1, boardA2 } = createTwoWorkspaces();
    mgr.moveBoardToWorkspace(boardA2, wsB);
    expect(mgr.snapshot().activeWorkspaceId).toBe(wsA);
    mgr.moveBoardToWorkspace(boardA1, wsB);
    expect(mgr.snapshot().activeWorkspaceId).toBe(wsA);
    expect(mgr.snapshot().workspace.board).toBeNull();
  });

  test("移動先で最後のタブが終了したとき、消えるのは移したBoardだけ（移動先が空扱いにならない）", () => {
    const { mgr, created, wsB, boardA2, boardB1, boardIdsOf } = createTwoWorkspaces();
    mgr.moveBoardToWorkspace(boardA2, wsB);
    // boardA2のタブ（2番目に作られたセッション）のシェルを終了させる
    created[1]?.opts.onExit?.(0);
    expect(boardIdsOf(wsB)).toEqual([boardB1]);
    expect(mgr.hasBoard(boardA2)).toBe(false);
  });

  test("同じワークスペースを指定した場合はtoIndexへの並び替えとして扱う", () => {
    const { mgr, wsA, boardA1, boardA2, boardIdsOf } = createTwoWorkspaces();
    expect(mgr.moveBoardToWorkspace(boardA2, wsA, 0)).toEqual({ ok: true });
    expect(boardIdsOf(wsA)).toEqual([boardA2, boardA1]);
  });

  test("存在しないboardId・workspaceIdは理由付きで失敗する", () => {
    const { mgr, wsB, boardA2 } = createTwoWorkspaces();
    expect(mgr.moveBoardToWorkspace("not-found", wsB)).toEqual({
      ok: false,
      reason: "board-not-found",
    });
    expect(mgr.moveBoardToWorkspace(boardA2, "not-found")).toEqual({
      ok: false,
      reason: "workspace-not-found",
    });
  });

  test("Board名・起動時レイアウトの紐づけは移動先へ引き継がれる", () => {
    const { mgr, wsB, boardA2 } = createTwoWorkspaces();
    mgr.setBoardName(boardA2, "repoA");
    mgr.setBoardStartup(boardA2, { preset: "dev", restoreMode: "layout" });
    mgr.moveBoardToWorkspace(boardA2, wsB);
    const moved = mgr
      .listWorkspaces()
      .find((e) => e.workspaceId === wsB)
      ?.boards.find((b) => b.boardId === boardA2);
    expect(moved?.name).toBe("repoA");
    expect(moved?.startup).toEqual({ preset: "dev", restoreMode: "layout" });
  });
});

describe("moveWorkspace", () => {
  function createThreeWorkspaces() {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const thirdId = mgr.snapshot().activeWorkspaceId;
    return { mgr, firstId, secondId, thirdId };
  }

  test("指定したindexへ移動する（間のワークスペースは詰められる）", () => {
    const { mgr, firstId, secondId, thirdId } = createThreeWorkspaces();
    expect(mgr.moveWorkspace(firstId, 2)).toBe(true);
    expect(mgr.snapshot().workspaceIds).toEqual([secondId, thirdId, firstId]);
  });

  test("末尾から先頭へも移動できる", () => {
    const { mgr, firstId, secondId, thirdId } = createThreeWorkspaces();
    expect(mgr.moveWorkspace(thirdId, 0)).toBe(true);
    expect(mgr.snapshot().workspaceIds).toEqual([thirdId, firstId, secondId]);
  });

  test("範囲外のindexは先頭・末尾へクランプする", () => {
    const { mgr, firstId, secondId, thirdId } = createThreeWorkspaces();
    expect(mgr.moveWorkspace(firstId, 99)).toBe(true);
    expect(mgr.snapshot().workspaceIds).toEqual([secondId, thirdId, firstId]);
    expect(mgr.moveWorkspace(firstId, -5)).toBe(true);
    expect(mgr.snapshot().workspaceIds).toEqual([firstId, secondId, thirdId]);
  });

  test("アクティブなワークスペースは変わらない", () => {
    const { mgr, firstId, thirdId } = createThreeWorkspaces();
    mgr.moveWorkspace(firstId, 2);
    expect(mgr.snapshot().activeWorkspaceId).toBe(thirdId);
  });

  test("存在しないworkspaceId・数値でないindexはfalseで順序は変わらない", () => {
    const { mgr, firstId, secondId, thirdId } = createThreeWorkspaces();
    expect(mgr.moveWorkspace("not-found", 0)).toBe(false);
    expect(mgr.moveWorkspace(firstId, Number.NaN)).toBe(false);
    expect(mgr.snapshot().workspaceIds).toEqual([firstId, secondId, thirdId]);
  });

  test("moveWorkspaceByは相対位置へ移動し、端では何もせずtrueを返す", () => {
    const { mgr, firstId, secondId, thirdId } = createThreeWorkspaces();
    expect(mgr.moveWorkspaceBy(thirdId, -1)).toBe(true);
    expect(mgr.snapshot().workspaceIds).toEqual([firstId, thirdId, secondId]);
    expect(mgr.moveWorkspaceBy(firstId, -1)).toBe(true);
    expect(mgr.snapshot().workspaceIds).toEqual([firstId, thirdId, secondId]);
  });

  test("moveWorkspaceByは存在しないworkspaceIdでfalse", () => {
    const { mgr } = createThreeWorkspaces();
    expect(mgr.moveWorkspaceBy("not-found", 1)).toBe(false);
  });

  test("並び替えた順序は永続化データへ反映される", () => {
    const { mgr, firstId } = createThreeWorkspaces();
    mgr.moveWorkspace(firstId, 2);
    // activeWorkspaceIndexも移動後のorderを基準に振り直される
    expect(mgr.serializeForPersistence().activeWorkspaceIndex).toBe(1);
  });
});

describe("swapWorkspaces", () => {
  test("2つのworkspaceIdの表示順を入れ替え、trueを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const thirdId = mgr.snapshot().activeWorkspaceId;

    expect(mgr.swapWorkspaces(firstId, thirdId)).toBe(true);
    expect(mgr.snapshot().workspaceIds).toEqual([thirdId, secondId, firstId]);
  });

  test("中身（レイアウト・アクティブワークスペース）は変更しない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;

    mgr.swapWorkspaces(firstId, secondId);

    // アクティブなのは相変わらずsecondId（swapはorderの位置だけを動かす）
    expect(mgr.snapshot().activeWorkspaceId).toBe(secondId);
  });

  test("同一idを渡すとfalse", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const onlyId = mgr.snapshot().activeWorkspaceId;
    expect(mgr.swapWorkspaces(onlyId, onlyId)).toBe(false);
  });

  test("存在しないworkspaceIdを渡すとfalseで順序は変わらない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const onlyId = mgr.snapshot().activeWorkspaceId;
    expect(mgr.swapWorkspaces(onlyId, "not-found")).toBe(false);
    expect(mgr.snapshot().workspaceIds).toEqual([onlyId]);
  });
});

describe("tileId/tabIdベースの操作は所属workspaceへ自動的にルーティングされる", () => {
  test("非アクティブなワークスペースのタイルへもsplitTile/newTab/closeTabが届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.newWorkspace(); // 以後、first workspaceは非アクティブ

    const newTabId = mgr.newTab(firstTileId);
    expect(newTabId).not.toBeNull();
    mgr.switchWorkspace(firstId);
    const afterNewTab = mgr.snapshot().workspace.board.layout as TileLeaf;
    expect(afterNewTab.tabIds.length).toBe(2);

    const splitResult = mgr.splitTile(firstTileId, "vertical");
    expect(splitResult).not.toBeNull();
    const afterSplit = mgr.snapshot().workspace.board.layout;
    expect(afterSplit.kind).toBe("split");
  });

  test("tabIdベースのhandleInput/handlePaste/handleResizeも所属workspaceへ届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newWorkspace();

    // 例外を投げず、非アクティブワークスペース内のタブへも到達できることのみ確認
    expect(() => mgr.handleInput(firstTabId, "a")).not.toThrow();
    expect(() => mgr.handlePaste(firstTabId, "b")).not.toThrow();
    expect(() => mgr.handleResize(firstTabId, 80, 24, 8, 16)).not.toThrow();
  });

  test("存在しないtileId/tabIdへの操作は何もせず例外も投げない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.newTab("not-found")).toBeNull();
    expect(() => mgr.handleInput("not-found", "x")).not.toThrow();
  });

  test("非アクティブなワークスペースのタイルへもnewBrowserTabが届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.newWorkspace(); // 以後、first workspaceは非アクティブ

    const newTabId = mgr.newBrowserTab(firstTileId, "https://example.com");
    expect(newTabId).not.toBeNull();
    mgr.switchWorkspace(firstId);
    expect(mgr.snapshot().workspace.board.tabs[newTabId as string]).toEqual({
      kind: "browser",
      url: "https://example.com",
    });
  });

  test("非アクティブなワークスペースのタイルへもtoggleZoomTileが届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.newWorkspace(); // 以後、first workspaceは非アクティブ

    expect(mgr.toggleZoomTile(firstTileId)).toBe(true);
    mgr.switchWorkspace(firstId);
    expect(mgr.snapshot().workspace.board.zoomedTileId).toBe(firstTileId);
  });

  test("存在しないtileIdへのtoggleZoomTileはnullを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.toggleZoomTile("not-found")).toBeNull();
  });

  test("focusDirectionは常にアクティブなワークスペースへルーティングされる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    const before = mgr.snapshot().workspace.board.focusedTileId;
    mgr.focusDirection("left");
    expect(mgr.snapshot().workspace.board.focusedTileId).not.toBe(before);
  });
});

describe("タブ変数(setTabVar/getTabVar/listTabVars)", () => {
  test("非アクティブなワークスペースのタブへも届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newWorkspace(); // 以後、firstTabId所属のworkspaceは非アクティブ

    expect(mgr.setTabVar(firstTabId, "status", "running")).toBe(true);
    expect(mgr.getTabVar(firstTabId, "status")).toEqual({ found: true, value: "running" });
    expect(mgr.listTabVars(firstTabId)).toEqual({ status: "running" });
  });

  test("タブAが書いた変数をタブBから読める（tabIdを指定すれば所属workspaceに関わらずアクセスできる）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileA = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const splitResult = mgr.splitTile(tileA, "vertical");
    const tabB = splitResult?.tabId as string;

    // タブAが自身の状態をtabVarに書く
    mgr.setTabVar(tabA, "status", "running");
    // タブBが送信元（タブA）のtabVarを読む
    expect(mgr.getTabVar(tabA, "status")).toEqual({ found: true, value: "running" });

    // タブBが読んでいる間にタブAが値を更新する
    mgr.setTabVar(tabA, "status", "done");
    expect(mgr.getTabVar(tabA, "status")).toEqual({ found: true, value: "done" });

    // tabBには影響しない（namespace分離）
    expect(mgr.getTabVar(tabB, "status")).toEqual({ found: false, reason: "not-set" });
  });

  test("異なるタブ間で変数が混ざらない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileA = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const splitResult = mgr.splitTile(tileA, "vertical");
    const tabB = splitResult?.tabId as string;

    mgr.setTabVar(tabA, "k", "a-value");
    mgr.setTabVar(tabB, "k", "b-value");

    expect(mgr.getTabVar(tabA, "k")).toEqual({ found: true, value: "a-value" });
    expect(mgr.getTabVar(tabB, "k")).toEqual({ found: true, value: "b-value" });
  });

  test("同一タイル内の複数タブでも変数が混ざらない（タブ単位化の主目的）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const tabB = mgr.newTab(tileId) as string;

    mgr.setTabVar(tabA, "agent_status", "working");
    mgr.setTabVar(tabB, "agent_status", "idle");

    expect(mgr.getTabVar(tabA, "agent_status")).toEqual({ found: true, value: "working" });
    expect(mgr.getTabVar(tabB, "agent_status")).toEqual({ found: true, value: "idle" });
  });

  test("存在しないtabIdはsetがfalse、getがtab-not-found、listがnull", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.setTabVar("not-found", "k", "v")).toBe(false);
    expect(mgr.getTabVar("not-found", "k")).toEqual({ found: false, reason: "tab-not-found" });
    expect(mgr.listTabVars("not-found")).toBeNull();
  });
});

describe("findTabsByVar", () => {
  test("別ワークスペース・別タイルにまたがっても値が一致するタブを全て見つける", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileA = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const splitResult = mgr.splitTile(tileA, "vertical");
    const tabB = splitResult?.tabId as string;
    mgr.newWorkspace();
    const tabC = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;

    mgr.setTabVar(tabA, "role", "editor");
    mgr.setTabVar(tabB, "role", "shell");
    mgr.setTabVar(tabC, "role", "editor");

    expect(mgr.findTabsByVar("role", "editor").sort()).toEqual([tabA, tabC].sort());
    expect(mgr.findTabsByVar("role", "shell")).toEqual([tabB]);
    expect(mgr.findTabsByVar("role", "no-such-value")).toEqual([]);
  });

  test("誰も設定していないkeyはvalueに関わらず空配列", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.findTabsByVar("role", "editor")).toEqual([]);
  });
});

describe("findTabsByVarInBoard", () => {
  test("同じワークスペース内でも別Boardの一致は含まない（同じレイアウトプリセットの複数適用で混線しない）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.listWorkspaces()[0]?.workspaceId as string;
    const boardA = mgr.listWorkspaces()[0]?.activeBoardId as string;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const boardB = mgr.newBoard(workspaceId) as string;
    const tabB = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;

    mgr.setTabVar(tabA, "role", "claude");
    mgr.setTabVar(tabB, "role", "claude");

    expect(mgr.findTabsByVarInBoard(boardA, "role", "claude")).toEqual([tabA]);
    expect(mgr.findTabsByVarInBoard(boardB, "role", "claude")).toEqual([tabB]);
  });

  test("同一Board内は分割した全タイル・タブを横断し、別ワークスペースの一致は含まない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const boardA = mgr.listWorkspaces()[0]?.activeBoardId as string;
    const tileA = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const tabB = mgr.splitTile(tileA, "vertical")?.tabId as string;
    mgr.newWorkspace();
    const tabC = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;

    mgr.setTabVar(tabA, "role", "claude");
    mgr.setTabVar(tabB, "role", "claude");
    mgr.setTabVar(tabC, "role", "claude");

    expect(mgr.findTabsByVarInBoard(boardA, "role", "claude")?.sort()).toEqual([tabA, tabB].sort());
  });

  test("存在しないboardIdはnull", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.findTabsByVarInBoard("not-found", "role", "claude")).toBeNull();
  });
});

describe("タブ名・タイル名(setTabName/setTileName)", () => {
  test("setTabNameで設定した名前がlistWorkspaces()のtabNamesに反映される", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;

    expect(mgr.setTabName(tabId, "roadmap")).toBe(true);

    expect(mgr.listWorkspaces()[0]?.boards[0]?.tabNames).toEqual({ [tabId]: "roadmap" });
  });

  test("setTileNameで設定した名前がlistWorkspaces()のtileNamesに反映される", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;

    expect(mgr.setTileName(tileId, "作業ペイン")).toBe(true);

    expect(mgr.listWorkspaces()[0]?.boards[0]?.tileNames).toEqual({ [tileId]: "作業ペイン" });
  });

  test("空文字列を設定すると名前がクリアされデフォルトへ戻る", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;

    mgr.setTabName(tabId, "roadmap");
    mgr.setTabName(tabId, "");

    expect(mgr.listWorkspaces()[0]?.boards[0]?.tabNames).toEqual({});
  });

  test("存在しないtabId/tileIdへのsetはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.setTabName("not-found", "x")).toBe(false);
    expect(mgr.setTileName("not-found", "x")).toBe(false);
  });

  test("非アクティブなワークスペースのタブ・タイルへも届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newWorkspace(); // 以後、firstTileId/firstTabId所属のworkspaceは非アクティブ

    expect(mgr.setTabName(firstTabId, "roadmap")).toBe(true);
    expect(mgr.setTileName(firstTileId, "作業ペイン")).toBe(true);
  });
});

describe("ワークスペースが空になった時の挙動", () => {
  test("他にワークスペースがあれば、最後のタブのプロセスが終了してもBoard 0個のまま残る", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const secondId = mgr.newWorkspace();
    resolvePending(mgr);

    created[1]?.opts.onExit?.(0);

    expect(mgr.snapshot().workspaceIds).toEqual([firstId, secondId]);
    expect(mgr.snapshot().activeWorkspaceId).toBe(secondId);
    expect(mgr.snapshot().workspace.board).toBeNull();
    expect(mgr.snapshot().workspace.activeBoardId).toBeNull();
  });

  test("Board 0個のワークスペースでもnewBoardで作業を再開できる", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const secondId = mgr.newWorkspace();
    resolvePending(mgr);
    created[1]?.opts.onExit?.(0);

    const boardId = mgr.newBoard(secondId);

    expect(boardId).not.toBeNull();
    expect(mgr.snapshot().workspace.activeBoardId).toBe(boardId as string);
    expect(mgr.snapshot().workspace.board).not.toBeNull();
  });

  test("最後の1つのワークスペースの最後のタブが終了するとonAllWorkspacesClosedが呼ばれる", () => {
    const { created, factory } = createFakeSessionFactory();
    let allClosed = false;
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, onAllWorkspacesClosed: () => (allClosed = true) }),
    );
    resolvePending(mgr);
    created[0]?.opts.onExit?.(0);
    expect(allClosed).toBe(true);
  });
});

describe("restoreFrom（永続化からの復元）", () => {
  test("workspaces配列の件数分ワークスペースが復元され、各leafの全タブ分セッションが起動する", () => {
    const { created, factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 3,
      activeWorkspaceIndex: 0,
      workspaces: [
        {
          activeBoardIndex: 0,
          boards: [
            {
              layout: {
                kind: "split",
                direction: "row",
                ratio: 0.5,
                first: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
                second: {
                  kind: "leaf",
                  tabs: [{ kind: "terminal" }, { kind: "terminal" }],
                  activeTabIndex: 1,
                },
              },
            },
          ],
        },
        {
          activeBoardIndex: 0,
          boards: [{ layout: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 } }],
        },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    resolvePending(mgr);

    expect(mgr.snapshot().workspaceIds.length).toBe(2);
    expect(created.length).toBe(4); // 1つ目のworkspaceに3タブ、2つ目に1タブ
    expect(mgr.snapshot().workspace.board.layout.kind).toBe("split");
  });

  test("activeWorkspaceIndexで指定したワークスペースがアクティブになる", () => {
    const { factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 3,
      activeWorkspaceIndex: 1,
      workspaces: [
        {
          activeBoardIndex: 0,
          boards: [{ layout: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 } }],
        },
        {
          activeBoardIndex: 0,
          boards: [{ layout: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 } }],
        },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    const snap = mgr.snapshot();
    expect(snap.activeWorkspaceId).toBe(snap.workspaceIds[1]);
  });

  test("範囲外のactiveWorkspaceIndexは末尾にクランプされる", () => {
    const { factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 3,
      activeWorkspaceIndex: 99,
      workspaces: [
        {
          activeBoardIndex: 0,
          boards: [{ layout: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 } }],
        },
        {
          activeBoardIndex: 0,
          boards: [{ layout: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 } }],
        },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    const snap = mgr.snapshot();
    expect(snap.activeWorkspaceId).toBe(snap.workspaceIds[1]);
  });

  test("workspacesが空のrestoreFromは無視され、単一ワークスペースで初期化される", () => {
    const { factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = { version: 3, activeWorkspaceIndex: 0, workspaces: [] };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    expect(mgr.snapshot().workspaceIds.length).toBe(1);
  });

  test("ワークスペース名が復元されlistWorkspaces()のnameに反映される", () => {
    const { factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 3,
      activeWorkspaceIndex: 0,
      workspaces: [
        {
          name: "作業env",
          activeBoardIndex: 0,
          boards: [{ layout: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 } }],
        },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    expect(mgr.listWorkspaces()[0]?.name).toBe("作業env");
  });

  test("terminalタブのshell/vars.cwdがspawnされたセッションへ渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 3,
      activeWorkspaceIndex: 0,
      workspaces: [
        {
          activeBoardIndex: 0,
          boards: [
            {
              layout: {
                kind: "leaf",
                tabs: [
                  {
                    kind: "terminal",
                    shell: "wsl.exe -d NixOS",
                    vars: { cwd: "/home/eetann/project" },
                  },
                ],
                activeTabIndex: 0,
              },
            },
          ],
        },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    resolvePending(mgr);

    expect(created[0]?.opts.shell).toBe("wsl.exe -d NixOS");
    expect(created[0]?.opts.cwd).toBe("/home/eetann/project");
  });

  test("browserタブはPTYセッションを増やさず復元される", () => {
    const { created, factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 3,
      activeWorkspaceIndex: 0,
      workspaces: [
        {
          activeBoardIndex: 0,
          boards: [
            {
              layout: {
                kind: "leaf",
                tabs: [{ kind: "browser", url: "https://example.com" }],
                activeTabIndex: 0,
              },
            },
          ],
        },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;

    expect(created.length).toBe(0);
    expect(mgr.snapshot().workspace.board.tabs[tabId]).toEqual({
      kind: "browser",
      url: "https://example.com",
    });
  });

  test("フォーカスされていたleafが復元後も同じ相対位置（split.second）でフォーカスされる", () => {
    const { factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 3,
      activeWorkspaceIndex: 0,
      workspaces: [
        {
          activeBoardIndex: 0,
          boards: [
            {
              layout: {
                kind: "split",
                direction: "row",
                ratio: 0.5,
                first: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
                second: {
                  kind: "leaf",
                  tabs: [{ kind: "terminal" }],
                  activeTabIndex: 0,
                  focused: true,
                },
              },
            },
          ],
        },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    const layout = mgr.snapshot().workspace.board.layout as TileNode & { kind: "split" };
    expect(mgr.snapshot().workspace.board.focusedTileId).toBe((layout.second as TileLeaf).id);
  });
});

describe("serializeForPersistence", () => {
  test("現在のワークスペース構成をPersistedStateとして書き出せる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    mgr.newWorkspace();

    const persisted = mgr.serializeForPersistence();

    expect(persisted.version).toBe(3);
    expect(persisted.workspaces.length).toBe(2);
    expect(persisted.workspaces[0]?.boards[0]?.layout.kind).toBe("split");
    expect(persisted.workspaces[1]?.boards[0]?.layout).toEqual({
      kind: "leaf",
      tabs: [{ kind: "terminal" }],
      activeTabIndex: 0,
      focused: true,
    });
    expect(persisted.activeWorkspaceIndex).toBe(1);
  });

  test("serializeForPersistence -> restoreFrom のラウンドトリップで同じ骨格になる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    const split = mgr.snapshot().workspace.board.layout as TileNode & { kind: "split" };
    mgr.newTab((split.first as TileLeaf).id);

    const persisted = mgr.serializeForPersistence();
    const restored = createWorkspaceManager(
      baseOpts({ createSession: factory, restoreFrom: persisted }),
    );

    expect(restored.serializeForPersistence()).toEqual(persisted);
  });

  test("ワークスペース名・タイル名・タブ名・タブ変数・shell・cwd・フォーカス・browserタブを含む完全な状態がラウンドトリップする", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }),
    );
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.setTabName(firstTabId, "work");
    mgr.setTileName(firstTileId, "editor");
    mgr.setTabVar(firstTabId, "cwd", "/home/eetann");
    mgr.newBrowserTab(firstTileId, "https://example.com");
    mgr.setWorkspaceName(mgr.snapshot().activeWorkspaceId, "main");
    mgr.focusTile(firstTileId);

    const persisted = mgr.serializeForPersistence();
    const restored = createWorkspaceManager(
      baseOpts({ createSession: factory, restoreFrom: persisted }),
    );

    expect(restored.serializeForPersistence()).toEqual(persisted);
    expect(persisted.workspaces[0]?.name).toBe("main");
  });

  test("Board 0個のワークスペースも名前ごと保存・復元される", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const secondId = mgr.newWorkspace();
    mgr.setWorkspaceName(secondId, "review");
    resolvePending(mgr);
    created[1]?.opts.onExit?.(0);

    const persisted = mgr.serializeForPersistence();
    expect(persisted.workspaces[1]?.boards).toEqual([]);

    const restored = createWorkspaceManager(
      baseOpts({ createSession: factory, restoreFrom: persisted }),
    );

    expect(restored.listWorkspaces().map((e) => e.name)).toEqual([null, "review"]);
    expect(restored.listWorkspaces()[1]?.boards).toEqual([]);
    expect(restored.snapshot().workspace.board).toBeNull();
  });
});

describe("Boardの起動時レイアウト設定(setBoardStartup/getBoardStartup/listStartupLayoutBoards)", () => {
  test("設定した内容がgetBoardStartupで読め、永続化にも載る", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const boardId = mgr.snapshot().workspace.activeBoardId;

    expect(mgr.getBoardStartup(boardId)).toBeNull();
    expect(mgr.setBoardStartup(boardId, { preset: "dev", restoreMode: "layout" })).toBe(true);
    expect(mgr.getBoardStartup(boardId)).toEqual({ preset: "dev", restoreMode: "layout" });
    expect(mgr.serializeForPersistence().workspaces[0]?.boards[0]?.startup).toEqual({
      preset: "dev",
      restoreMode: "layout",
    });
  });

  test("nullを渡すと紐づけが解除され、永続化からも消える", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const boardId = mgr.snapshot().workspace.activeBoardId;
    mgr.setBoardStartup(boardId, { preset: "dev", restoreMode: "layout" });

    expect(mgr.setBoardStartup(boardId, null)).toBe(true);
    expect(mgr.getBoardStartup(boardId)).toBeNull();
    expect(mgr.serializeForPersistence().workspaces[0]?.boards[0]?.startup).toBeUndefined();
  });

  test("存在しないboardIdにはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.setBoardStartup("board-nope", { preset: "dev", restoreMode: "layout" })).toBe(false);
    expect(mgr.getBoardStartup("board-nope")).toBeNull();
  });

  test('listStartupLayoutBoardsはrestoreMode: "layout"のBoardだけを全workspace横断で返す', () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstWorkspaceId = mgr.snapshot().activeWorkspaceId;
    const layoutBoardId = mgr.snapshot().workspace.activeBoardId;
    const restoreBoardId = mgr.newBoard(firstWorkspaceId) as string;
    mgr.newWorkspace();
    const otherLayoutBoardId = mgr.snapshot().workspace.activeBoardId;

    mgr.setBoardStartup(layoutBoardId, { preset: "dev", restoreMode: "layout" });
    mgr.setBoardStartup(restoreBoardId, { preset: "notes", restoreMode: "restore" });
    mgr.setBoardStartup(otherLayoutBoardId, { preset: "docs", restoreMode: "layout" });

    expect(mgr.listStartupLayoutBoards()).toEqual([
      { boardId: layoutBoardId, preset: "dev", resumeOverride: null, resumeCommands: {} },
      { boardId: otherLayoutBoardId, preset: "docs", resumeOverride: null, resumeCommands: {} },
    ]);
  });

  test("listStartupLayoutBoardsはプリセットの解決元と紐づけ時のcwdもそのまま返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const projectBoardId = mgr.snapshot().workspace.activeBoardId;
    const globalBoardId = mgr.newBoard(workspaceId) as string;

    mgr.setBoardStartup(projectBoardId, {
      preset: "dev",
      restoreMode: "layout",
      projectRoot: "/home/me/repo",
    });
    mgr.setBoardStartup(globalBoardId, {
      preset: "dev",
      restoreMode: "layout",
      cwd: "/home/me/dotfiles",
    });

    expect(mgr.listStartupLayoutBoards()).toEqual([
      {
        boardId: projectBoardId,
        preset: "dev",
        projectRoot: "/home/me/repo",
        resumeOverride: null,
        resumeCommands: {},
      },
      {
        boardId: globalBoardId,
        preset: "dev",
        cwd: "/home/me/dotfiles",
        resumeOverride: null,
        resumeCommands: {},
      },
    ]);
  });

  test('restoreMode: "layout"のBoardは骨格を復元せず単一タブで復元される（applyLayoutPresetで組み直す前提）', () => {
    const { created, factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 3,
      activeWorkspaceIndex: 0,
      workspaces: [
        {
          activeBoardIndex: 0,
          boards: [
            {
              name: "dev",
              startup: { preset: "dev", restoreMode: "layout" },
              layout: {
                kind: "split",
                direction: "row",
                ratio: 0.5,
                first: {
                  kind: "leaf",
                  tabs: [{ kind: "terminal", name: "old", vars: { cwd: "/old" } }],
                  activeTabIndex: 0,
                },
                second: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
              },
            },
            {
              startup: { preset: "notes", restoreMode: "restore" },
              layout: {
                kind: "split",
                direction: "row",
                ratio: 0.5,
                first: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
                second: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
              },
            },
          ],
        },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    resolvePending(mgr);

    const [layoutBoard, restoreBoard] = mgr.listWorkspaces()[0]?.boards ?? [];
    // "layout"側は骨格ごと捨てられ、前回セッションのタブ名も持ち込まれない
    expect(layoutBoard?.layout.kind).toBe("leaf");
    expect(layoutBoard?.tabNames).toEqual({});
    expect(layoutBoard?.name).toBe("dev");
    expect(layoutBoard?.startup).toEqual({ preset: "dev", restoreMode: "layout" });
    // "restore"側は従来どおり骨格を復元する
    expect(restoreBoard?.layout.kind).toBe("split");
    // 起動したセッションは "layout"側1つ + "restore"側2つ
    expect(created.length).toBe(3);
  });

  test("startupを含む状態がserializeForPersistence -> restoreFromでラウンドトリップする", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const boardId = mgr.snapshot().workspace.activeBoardId;
    mgr.setBoardStartup(boardId, { preset: "dev", restoreMode: "layout" });

    const persisted = mgr.serializeForPersistence();
    const restored = createWorkspaceManager(
      baseOpts({ createSession: factory, restoreFrom: persisted }),
    );

    expect(restored.serializeForPersistence()).toEqual(persisted);
  });
});

describe("setBrowserTabUrl", () => {
  test("非アクティブなワークスペースのbrowserタブへも届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(firstTileId, "https://example.com") as string;
    mgr.newWorkspace();

    expect(mgr.setBrowserTabUrl(tabId, "https://example.com/next")).toBe(true);
    mgr.switchWorkspace(firstId);
    expect(mgr.snapshot().workspace.board.tabs[tabId]).toEqual({
      kind: "browser",
      url: "https://example.com/next",
    });
  });

  test("存在しないtabIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    expect(mgr.setBrowserTabUrl("not-found", "https://example.com")).toBe(false);
  });
});

describe("listWorkspaces", () => {
  test("全ワークスペース分の構造をorder順で返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;

    const list = mgr.listWorkspaces();
    expect(list.map((e) => e.workspaceId)).toEqual([firstId, secondId]);
    expect(list.find((e) => e.workspaceId === secondId)?.active).toBe(true);
    expect(list.find((e) => e.workspaceId === firstId)?.active).toBe(false);
  });

  test("focusedTileIdとlayoutが各workspaceのgetLayout/getFocusedTileIdと一致する", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");

    const entry = mgr.listWorkspaces()[0];
    expect(entry?.boards[0]?.layout).toEqual(mgr.snapshot().workspace.board.layout);
    expect(entry?.boards[0]?.focusedTileId).toBe(mgr.snapshot().workspace.board.focusedTileId);
  });

  test("snapshot().workspacesはlistWorkspaces()と一致する（サイドバー描画用データ）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    mgr.newWorkspace();

    expect(mgr.snapshot().workspaces).toEqual(mgr.listWorkspaces());
  });

  test("tabVarsに各タブのタブ変数がtabIdをキーに含まれる（未設定なら空オブジェクト）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const split = mgr.splitTile(firstTileId, "vertical");
    mgr.setTabVar(firstTabId, "branch", "main");

    const entry = mgr.listWorkspaces()[0];
    expect(entry?.boards[0]?.tabVars).toEqual({
      [firstTabId]: { branch: "main" },
      [split?.tabId as string]: {},
    });
  });

  test("1タイル内に複数タブがあると、tabVarsのキーはタイル単位ではなくタブ単位で並ぶ", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const secondTabId = mgr.newTab(tileId) as string;
    mgr.setTabVar(firstTabId, "agent_status", "working");
    mgr.setTabVar(secondTabId, "agent_status", "idle");

    const entry = mgr.listWorkspaces()[0];
    expect(entry?.boards[0]?.tabVars).toEqual({
      [firstTabId]: { agent_status: "working" },
      [secondTabId]: { agent_status: "idle" },
    });
  });
});

describe("hasTab", () => {
  test("存在するtabIdはtrue、存在しないtabIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    expect(mgr.hasTab(tabId)).toBe(true);
    expect(mgr.hasTab("not-found")).toBe(false);
  });
});

describe("locateTab / locateBrowserTab / isWorkspaceActive", () => {
  test("locateTabは種別問わず所在workspaceId/tileIdを返す。非アクティブなワークスペースでも見つかる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.snapshot().workspace.activeBoardId;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const terminalTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const browserTabId = mgr.newBrowserTab(firstTileId, "https://example.com") as string;
    mgr.newWorkspace(); // 以後、firstIdは非アクティブ

    expect(mgr.locateTab(terminalTabId)).toEqual({
      workspaceId: firstId,
      boardId: firstBoardId,
      tileId: firstTileId,
    });
    expect(mgr.locateTab(browserTabId)).toEqual({
      workspaceId: firstId,
      boardId: firstBoardId,
      tileId: firstTileId,
    });
    expect(mgr.locateTab("not-found")).toBeNull();
  });

  test("locateBrowserTabはbrowserタブのみ所在を返し、terminalタブはnull", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.snapshot().workspace.activeBoardId;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const terminalTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const browserTabId = mgr.newBrowserTab(firstTileId, "https://example.com") as string;

    expect(mgr.locateBrowserTab(browserTabId)).toEqual({
      workspaceId: firstId,
      boardId: firstBoardId,
      tileId: firstTileId,
    });
    expect(mgr.locateBrowserTab(terminalTabId)).toBeNull();
  });

  test("isWorkspaceActiveはアクティブなworkspaceIdのみtrue", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;

    expect(mgr.isWorkspaceActive(firstId)).toBe(false);
    expect(mgr.isWorkspaceActive(secondId)).toBe(true);
  });
});

describe("showTab", () => {
  test("非アクティブなワークスペースのタブへ切替・フォーカス・アクティブ化をまとめて行い、trueを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const targetTabId = mgr.newTab(firstTileId) as string;
    mgr.newWorkspace(); // 以後、firstIdは非アクティブ

    expect(mgr.isWorkspaceActive(firstId)).toBe(false);
    expect(mgr.showTab(targetTabId)).toBe(true);

    expect(mgr.isWorkspaceActive(firstId)).toBe(true);
    expect(mgr.getFocusedTileId()).toBe(firstTileId);
    expect(mgr.getActiveTabId(firstTileId)).toBe(targetTabId);
  });

  test("存在しないtabIdはfalseを返し、状態を変えない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;

    expect(mgr.showTab("not-found")).toBe(false);
    expect(mgr.snapshot().activeWorkspaceId).toBe(firstId);
  });
});

describe("getTabText", () => {
  test("存在するtabIdはテキストを返し、存在しないtabIdはnullを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    resolvePending(mgr);
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    expect(mgr.getTabText(tabId)).toBe("");
    expect(mgr.getTabText("not-found")).toBeNull();
  });

  test("非アクティブなワークスペースのタブへも届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    resolvePending(mgr);
    mgr.newWorkspace();
    expect(mgr.getTabText(firstTabId)).toBe("");
  });
});

describe("switchTab / closeTab / focusTileの戻り値", () => {
  test("switchTabは成功時true、存在しないtileId/tabIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const newTabId = mgr.newTab(tileId) as string;

    expect(mgr.switchTab(tileId, newTabId)).toBe(true);
    expect(mgr.switchTab("not-found", newTabId)).toBe(false);
    expect(mgr.switchTab(tileId, "not-found")).toBe(false);
  });

  test("closeTabは成功時true、存在しないtileId/tabIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const newTabId = mgr.newTab(tileId) as string;

    expect(mgr.closeTab("not-found", newTabId)).toBe(false);
    expect(mgr.closeTab(tileId, newTabId)).toBe(true);
  });

  test("focusTileは成功時true、存在しないtileIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;

    expect(mgr.focusTile(tileId)).toBe(true);
    expect(mgr.focusTile("not-found")).toBe(false);
  });
});

describe("moveTab", () => {
  test("同一workspace内のタイル間移動は成功する", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const movingTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const split = mgr.splitTile(firstTileId, "vertical") as { tileId: string };

    const result = mgr.moveTab(firstTileId, movingTabId, split.tileId);

    expect(result).toBe(true);
    const after = mgr.snapshot().workspace.board.layout;
    expect(after.kind).toBe("leaf");
    expect((after as TileLeaf).tabIds).toContain(movingTabId);
  });

  test("別workspaceのtileId同士の移動はfalseを返し、木は変化しない（PTYセッションを移管できないため非対応）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newWorkspace();
    const secondTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;

    const result = mgr.moveTab(firstTileId, firstTabId, secondTileId);

    expect(result).toBe(false);
    mgr.switchWorkspace(firstId);
    expect((mgr.snapshot().workspace.board.layout as TileLeaf).tabIds).toEqual([firstTabId]);
  });

  test("存在しないtileIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const leaf = mgr.snapshot().workspace.board.layout as TileLeaf;

    expect(mgr.moveTab("not-found", leaf.activeTabId, leaf.id)).toBe(false);
    expect(mgr.moveTab(leaf.id, leaf.activeTabId, "not-found")).toBe(false);
  });
});

describe("moveTabToSplit", () => {
  test("同一workspace内なら分割してタブを移せる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const movingTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const split = mgr.splitTile(firstTileId, "vertical") as { tileId: string };

    const result = mgr.moveTabToSplit(
      firstTileId,
      movingTabId,
      split.tileId,
      "horizontal",
      "after",
    );

    expect(result).toBe(true);
    const after = mgr.snapshot().workspace.board.layout;
    expect(after.kind).toBe("split");
  });

  test("別workspaceのtileIdへの分割はfalseを返す（PTYセッションを移管できないため非対応）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newWorkspace();
    const secondTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;

    const result = mgr.moveTabToSplit(firstTileId, firstTabId, secondTileId, "vertical", "after");

    expect(result).toBe(false);
    mgr.switchWorkspace(firstId);
    expect((mgr.snapshot().workspace.board.layout as TileLeaf).tabIds).toEqual([firstTabId]);
  });

  test("存在しないtileIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const leaf = mgr.snapshot().workspace.board.layout as TileLeaf;

    expect(mgr.moveTabToSplit("not-found", leaf.activeTabId, leaf.id, "vertical", "after")).toBe(
      false,
    );
    expect(mgr.moveTabToSplit(leaf.id, leaf.activeTabId, "not-found", "vertical", "after")).toBe(
      false,
    );
  });
});

describe("openPopup / closePopup / togglePopupVisibility / promotePopup", () => {
  test("openPopupは新規タブを作成しtabIdを返す。2回目のopenPopupはnullを返す（同時1つ制約）", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const before = created.length;

    const tabId = mgr.openPopup();
    // PTYはopenPopup直後ではなく、webview側の実測サイズが届く最初のhandleResizeで起動する
    // （SIGWINCH到達前に起動しているとresizeを取りこぼすTUIがあるため）
    expect(created.length).toBe(before);
    mgr.handleResize(tabId as string, 80, 24, 8, 16);

    expect(tabId).not.toBeNull();
    expect(created.length).toBe(before + 1);
    expect(mgr.snapshot().workspace.popup).toEqual({
      tabId: tabId as string,
      visible: true,
      width: undefined,
      height: undefined,
      x: undefined,
      y: undefined,
    });
    expect(mgr.openPopup()).toBeNull();
  });

  test("Board 0個になると開いていたpopupは閉じられ、新たに開くこともできない", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const secondId = mgr.newWorkspace();
    resolvePending(mgr);
    const popupTabId = mgr.openPopup() as string;
    mgr.handleResize(popupTabId, 80, 24, 8, 16);

    // 2つ目のワークスペースの唯一のタブが終了し、そのワークスペースがBoard 0個になる
    created[1]?.opts.onExit?.(0);

    expect(mgr.snapshot().activeWorkspaceId).toBe(secondId);
    expect(mgr.snapshot().workspace.popup).toBeNull();
    expect(mgr.openPopup()).toBeNull();
  });

  test("closePopupでpopupが閉じ、セッションがdisposeされる。popup無しではfalseを返す", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));

    expect(mgr.closePopup()).toBe(false);

    const tabId = mgr.openPopup();
    mgr.handleResize(tabId as string, 80, 24, 8, 16);
    const ok = mgr.closePopup();

    expect(ok).toBe(true);
    expect(mgr.snapshot().workspace.popup).toBeNull();
    expect(created[created.length - 1]?.disposed).toBe(true);
  });

  test("openPopupのcwdもgetNewTabCwdの値になる（Board紐づけのワークツリーで開く）", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, getNewTabCwd: (path) => path }),
    );
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const boardId = mgr.newBoard(workspaceId, undefined, {
      worktreePath: "/repo/work/feature",
    }) as string;
    mgr.switchBoard(boardId);

    const tabId = mgr.openPopup() as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);

    expect(created[created.length - 1]?.opts.cwd).toBe("/repo/work/feature");
  });

  test("紐づけの無いBoardのopenPopupは従来どおりフォーカス中タブのcwdを引き継ぐ", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, getNewTabCwd: (path) => path }),
    );
    const focusedTabId = mgr.snapshot().workspace.board.focusedTileId;
    const leaf = listLeaves(mgr.snapshot().workspace.board.layout).find(
      (l) => l.id === focusedTabId,
    ) as TileLeaf;
    mgr.setTabVar(leaf.activeTabId, "cwd", "/tmp/reported");

    const tabId = mgr.openPopup() as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);

    expect(created[created.length - 1]?.opts.cwd).toBe("/tmp/reported");
  });

  test("togglePopupVisibilityはpopup無しでnull、popup有りでトグル後の可視状態を返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));

    expect(mgr.togglePopupVisibility()).toBeNull();

    mgr.openPopup();
    expect(mgr.snapshot().workspace.popup?.visible).toBe(true);
    expect(mgr.togglePopupVisibility()).toBe(false);
    expect(mgr.snapshot().workspace.popup?.visible).toBe(false);
    expect(mgr.togglePopupVisibility()).toBe(true);
    expect(mgr.snapshot().workspace.popup?.visible).toBe(true);
  });

  test("setPopupGeometryの値がsnapshotへ反映される", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = mgr.openPopup() as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);

    expect(mgr.setPopupGeometry({ x: 10, y: 20, width: 50, height: 40 })).toBe(true);

    expect(mgr.snapshot().workspace.popup).toMatchObject({
      x: 10,
      y: 20,
      width: 50,
      height: 40,
    });
  });

  test("setPopupGeometryは範囲外の値をクランプして保存する", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = mgr.openPopup() as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);

    // 幅が100超・xが負・y+heightが100超のいずれも画面内へ収める
    mgr.setPopupGeometry({ x: -10, y: 90, width: 150, height: 40 });

    expect(mgr.snapshot().workspace.popup).toMatchObject({
      x: 0,
      y: 60,
      width: 100,
      height: 40,
    });
  });

  test("setPopupGeometryは非有限値を拒否し、状態を変えない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = mgr.openPopup() as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);
    mgr.setPopupGeometry({ x: 10, y: 20, width: 50, height: 40 });

    expect(mgr.setPopupGeometry({ x: Number.NaN, y: 0, width: 50, height: 40 })).toBe(false);

    expect(mgr.snapshot().workspace.popup).toMatchObject({ x: 10, y: 20 });
  });

  test("setPopupGeometryはpopupが開いていなければfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));

    expect(mgr.setPopupGeometry({ x: 10, y: 20, width: 50, height: 40 })).toBe(false);
  });

  test("togglePopupVisibilityで隠して出してもジオメトリは維持される", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = mgr.openPopup() as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);
    mgr.setPopupGeometry({ x: 10, y: 20, width: 50, height: 40 });

    mgr.togglePopupVisibility();
    mgr.togglePopupVisibility();

    expect(mgr.snapshot().workspace.popup).toMatchObject({
      visible: true,
      x: 10,
      y: 20,
      width: 50,
      height: 40,
    });
  });

  test("closePopup後に開き直すとジオメトリは既定（未指定）へ戻る", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = mgr.openPopup() as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);
    mgr.setPopupGeometry({ x: 10, y: 20, width: 50, height: 40 });
    mgr.closePopup();

    const reopened = mgr.openPopup() as string;
    mgr.handleResize(reopened, 80, 24, 8, 16);

    expect(mgr.snapshot().workspace.popup).toEqual({
      tabId: reopened,
      visible: true,
      width: undefined,
      height: undefined,
      x: undefined,
      y: undefined,
    });
  });

  test("promotePopup後に開き直してもジオメトリは既定（未指定）へ戻る", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = mgr.openPopup() as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);
    mgr.setPopupGeometry({ x: 10, y: 20, width: 50, height: 40 });
    mgr.promotePopup();

    const reopened = mgr.openPopup() as string;
    mgr.handleResize(reopened, 80, 24, 8, 16);

    expect(mgr.snapshot().workspace.popup).toMatchObject({ x: undefined, y: undefined });
  });

  test("openPopupでサイズを指定してもx/yは未指定（中央のまま）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = mgr.openPopup({ width: 50, height: 50 }) as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);

    expect(mgr.snapshot().workspace.popup).toMatchObject({
      width: 50,
      height: 50,
      x: undefined,
      y: undefined,
    });
  });

  test("promotePopupはpopup無しでnullを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));

    expect(mgr.promotePopup()).toBeNull();
  });

  test("promotePopupはフォーカス中タイルへ編入し、セッションを作り直さない", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const popupTabId = mgr.openPopup() as string;
    mgr.handleResize(popupTabId, 80, 24, 8, 16);
    const createdCountAfterOpen = created.length;

    const result = mgr.promotePopup();

    expect(result).toEqual({ tileId, tabId: popupTabId });
    expect(created.length).toBe(createdCountAfterOpen); // セッションが作り直されないこと（ADR 0005）
    expect(mgr.snapshot().workspace.popup).toBeNull();
    const leaf = mgr.snapshot().workspace.board.layout as TileLeaf;
    expect(leaf.tabIds).toContain(popupTabId);
    expect(leaf.activeTabId).toBe(popupTabId);
  });

  test("promotePopupは常にopenPopup時ではなく実行時点のフォーカス中タイルへ編入する", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.openPopup();
    const split = mgr.splitTile(firstTileId, "vertical") as { tileId: string };
    // splitTileはfocusedTileIdを新しいタイルへ切り替える

    const result = mgr.promotePopup();

    expect(result?.tileId).toBe(split.tileId);
    const leaf = mgr.snapshot().workspace.board.layout;
    expect(leaf.kind).toBe("split");
  });
});

describe("ベル", () => {
  test("セッションのonBellはWorkspace・Boardを貫いてtabId付きで届く", () => {
    const { created, factory } = createFakeSessionFactory();
    const bells: string[] = [];
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, onBell: (tabId) => bells.push(tabId) }),
    );
    resolvePending(mgr);
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;

    created[0]?.opts.onBell?.();

    expect(bells).toEqual([tabId]);
  });

  test("clearBellOnVisibleTabsは画面に出ているタブのマークだけを消す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    resolvePending(mgr);
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const hiddenTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const visibleTabId = mgr.newTab(tileId);
    resolvePending(mgr);
    if (!visibleTabId) throw new Error("newTabに失敗した");
    mgr.setTabVar(hiddenTabId, "bell", "1");
    mgr.setTabVar(visibleTabId, "bell", "1");

    expect(mgr.clearBellOnVisibleTabs()).toBe(true);

    expect(mgr.getTabVar(visibleTabId, "bell").found).toBe(false);
    expect(mgr.getTabVar(hiddenTabId, "bell")).toEqual({ found: true, value: "1" });
  });

  test("isTabVisibleは非アクティブなワークスペースのタブにfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    resolvePending(mgr);
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newWorkspace();
    resolvePending(mgr);
    const secondTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;

    expect(mgr.isTabVisible(secondTabId)).toBe(true);
    expect(mgr.isTabVisible(firstTabId)).toBe(false);
  });

  test("getTabNameは設定済みのタブ名を返し、未設定・不存在はnull", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    resolvePending(mgr);
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;

    expect(mgr.getTabName(tabId)).toBeNull();
    mgr.setTabName(tabId, "build");
    expect(mgr.getTabName(tabId)).toBe("build");
    expect(mgr.getTabName("tab-does-not-exist")).toBeNull();
  });
});
