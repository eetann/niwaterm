import { describe, expect, test } from "bun:test";
import type { PersistedState } from "./persistence";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import { createWindowManager, type WindowManagerOptions } from "./window-manager";
import type { WorkspaceManager } from "./workspace-manager";

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
      jumpPrompt: () => false,
      renderState: () => ({
        kind: "terminal",
        html: "",
        cursorX: 0,
        cursorY: 0,
        cursorVisible: true,
        cursorShape: "block",
        viewportPinned: true,
        viewportOffset: 0,
        mouseTracking: false,
        mouseAnyMotion: false,
        paletteCss: null,
        copyMode: null,
        kittyPlacements: [],
        kittyImages: [],
      }),
      dumpText: () => "",
      getRunningCommand: () => null,
      showNotice: () => {},
      isCopyMode: () => false,
      enterCopyMode: () => {},
      exitCopyMode: () => {},
      handleCopyModeKey: () => false,
      setCallbacks: () => {},
      dispose: () => {
        record.disposed = true;
      },
    };
  };
  return { created, factory };
}

function baseOpts(
  overrides: Partial<WindowManagerOptions> & {
    createSession: WindowManagerOptions["createSession"];
  },
): WindowManagerOptions {
  return {
    initialCols: 80,
    initialRows: 24,
    onDirty: () => {},
    onWindowOpened: () => {},
    onWindowClosed: () => {},
    onAllWindowsClosed: () => {},
    ...overrides,
  };
}

function persistedWithTabName(name: string): PersistedState {
  return {
    version: 3,
    workspaces: [
      {
        boards: [
          {
            layout: {
              kind: "leaf",
              tabs: [{ kind: "terminal", name }],
              activeTabIndex: 0,
            },
          },
        ],
        activeBoardIndex: 0,
      },
    ],
    activeWorkspaceIndex: 0,
  };
}

/** そのウィンドウの唯一のタブのtabId */
function soleTabId(mgr: ReturnType<typeof createWindowManager>, windowId: string): string {
  const snap = mgr.snapshotOf(windowId);
  if (!snap) throw new Error(`window not found: ${windowId}`);
  const layout = snap.workspaces[0].boards[0].layout;
  if (layout.kind !== "leaf") throw new Error("expected a single leaf");
  return layout.tabIds[0];
}

describe("createWindowManager", () => {
  test("WorkspaceManagerとして扱える（ipc-server等へそのまま渡せる）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    // 崩れると複数ウィンドウ構成でipc-server・niwa-apiへ渡せなくなるため、型で固定しておく
    const asWorkspaceManager: WorkspaceManager = mgr;
    expect(asWorkspaceManager.listWorkspaces()).toHaveLength(1);
  });

  test("メインウィンドウは永続化データから復元する", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(
      baseOpts({ createSession: factory, restoreFrom: persistedWithTabName("restored") }),
    );
    expect(mgr.listWindows()).toHaveLength(1);
    expect(mgr.isPersistent(mgr.mainWindowId)).toBe(true);
    expect(mgr.getTabName(soleTabId(mgr, mgr.mainWindowId))).toBe("restored");
  });

  test("一時ウィンドウは復元せず、まっさらな状態で開く", () => {
    const { factory } = createFakeSessionFactory();
    const opened: string[] = [];
    const mgr = createWindowManager(
      baseOpts({
        createSession: factory,
        restoreFrom: persistedWithTabName("restored"),
        onWindowOpened: (windowId) => opened.push(windowId),
      }),
    );
    const windowId = mgr.newWindow();
    expect(opened).toEqual([windowId]);
    expect(mgr.isPersistent(windowId)).toBe(false);
    expect(mgr.getTabName(soleTabId(mgr, windowId))).toBeNull();
  });

  test("idはウィンドウをまたいで一意になる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    const second = mgr.newWindow();
    const ids = [
      ...mgr.snapshotOf(mgr.mainWindowId)!.workspaceIds,
      ...mgr.snapshotOf(second)!.workspaceIds,
      soleTabId(mgr, mgr.mainWindowId),
      soleTabId(mgr, second),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("id指定の操作は持ち主のウィンドウへ振り分ける", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    const second = mgr.newWindow();
    const mainTabId = soleTabId(mgr, mgr.mainWindowId);
    const secondTabId = soleTabId(mgr, second);

    expect(mgr.setTabName(mainTabId, "main-tab")).toBe(true);
    expect(mgr.setTabName(secondTabId, "second-tab")).toBe(true);
    expect(mgr.windowIdOfTab(mainTabId)).toBe(mgr.mainWindowId);
    expect(mgr.windowIdOfTab(secondTabId)).toBe(second);
    // 振り分けを間違えると別ウィンドウのタブ名が書き換わる
    expect(mgr.getTabName(mainTabId)).toBe("main-tab");
    expect(mgr.getTabName(secondTabId)).toBe("second-tab");
  });

  test("newTabのcommandを持ち主のウィンドウのタブ起動まで渡す", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    const tabId = soleTabId(mgr, mgr.mainWindowId);
    // 既存タブの起動を確定させ、newTabが保留せずその場で起動するサイズを持たせる
    mgr.handleResize(tabId, 80, 24, 8, 18);
    const layout = mgr.snapshotOf(mgr.mainWindowId)!.workspaces[0].boards[0].layout;
    if (layout.kind !== "leaf") throw new Error("expected a single leaf");

    expect(mgr.newTab(layout.id, undefined, undefined, "make build")).not.toBeNull();
    expect(created.at(-1)?.opts.command).toBe("make build");
  });

  test("id省略の操作はフォーカス中ウィンドウに効く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    const second = mgr.newWindow();
    // newWindow直後はそのウィンドウがフォーカス中
    expect(mgr.getFocusedWindowId()).toBe(second);
    mgr.newWorkspace();
    expect(mgr.snapshotOf(second)!.workspaceIds).toHaveLength(2);
    expect(mgr.snapshotOf(mgr.mainWindowId)!.workspaceIds).toHaveLength(1);

    mgr.setFocusedWindow(mgr.mainWindowId);
    mgr.newWorkspace();
    expect(mgr.snapshotOf(mgr.mainWindowId)!.workspaceIds).toHaveLength(2);
  });

  test("ウィンドウを閉じるとそのウィンドウのセッションだけ破棄される", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    const mainTabId = soleTabId(mgr, mgr.mainWindowId);
    const second = mgr.newWindow();
    const secondTabId = soleTabId(mgr, second);
    // PTY起動は実測サイズが届くまで保留されるため、ここで確定させる
    mgr.handleResize(mainTabId, 80, 24, 8, 18);
    mgr.handleResize(secondTabId, 80, 24, 8, 18);
    expect(created).toHaveLength(2);

    expect(mgr.closeWindow(second)).toBe(true);
    expect(created[0].disposed).toBe(false);
    expect(created[1].disposed).toBe(true);
    expect(mgr.hasWindow(second)).toBe(false);
    expect(mgr.hasTab(secondTabId)).toBe(false);
    expect(mgr.hasTab(mainTabId)).toBe(true);
    // フォーカスは残ったウィンドウへ移る
    expect(mgr.getFocusedWindowId()).toBe(mgr.mainWindowId);
  });

  test("最後のタブのプロセスが終了するとそのウィンドウが閉じる（アプリは終わらない）", () => {
    const { created, factory } = createFakeSessionFactory();
    const closed: string[] = [];
    let allClosed = 0;
    const mgr = createWindowManager(
      baseOpts({
        createSession: factory,
        onWindowClosed: (windowId) => closed.push(windowId),
        onAllWindowsClosed: () => {
          allClosed++;
        },
      }),
    );
    const second = mgr.newWindow();
    mgr.handleResize(soleTabId(mgr, mgr.mainWindowId), 80, 24, 8, 18);
    mgr.handleResize(soleTabId(mgr, second), 80, 24, 8, 18);

    created[1]?.opts.onExit?.(0);
    expect(closed).toEqual([second]);
    expect(allClosed).toBe(0);
    expect(mgr.listWindows()).toHaveLength(1);
  });

  test("最後のウィンドウが閉じたらonAllWindowsClosedを呼ぶ", () => {
    const { factory } = createFakeSessionFactory();
    let allClosed = 0;
    const mgr = createWindowManager(
      baseOpts({
        createSession: factory,
        onAllWindowsClosed: () => {
          allClosed++;
        },
      }),
    );
    const second = mgr.newWindow();
    mgr.closeWindow(second);
    expect(allClosed).toBe(0);
    mgr.closeWindow(mgr.mainWindowId);
    expect(allClosed).toBe(1);
    // 閉じ終わったウィンドウへの再呼び出しは何もしない
    expect(mgr.closeWindow(second)).toBe(false);
  });

  test("listWindowsは名前を付けたワークスペースだけworkspaceNamesへ載せる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    const named = mgr.listWorkspaces()[0].workspaceId;
    const unnamed = mgr.newWorkspace();
    mgr.setWorkspaceName(named, "dev");

    const entry = mgr.listWindows()[0];
    expect(entry.workspaceIds).toEqual([named, unnamed]);
    expect(entry.activeWorkspaceId).toBe(unnamed);
    expect(entry.workspaceNames).toEqual({ [named]: "dev" });
  });

  test("永続化対象はメインウィンドウの中身だけ", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    mgr.setTabName(soleTabId(mgr, mgr.mainWindowId), "main-tab");
    const second = mgr.newWindow();
    mgr.setTabName(soleTabId(mgr, second), "temp-tab");

    const state = mgr.persistentState();
    expect(state).not.toBeNull();
    expect(state!.workspaces).toHaveLength(1);
    const layout = state!.workspaces[0].boards[0].layout;
    expect(layout.kind === "leaf" && layout.tabs[0].name).toBe("main-tab");
  });

  test("メインウィンドウが閉じた後は永続化を見送る", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    mgr.newWindow();
    mgr.closeWindow(mgr.mainWindowId);
    expect(mgr.persistentState()).toBeNull();
  });

  test("ウィンドウをまたぐBoardの移動は受け付けない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    const second = mgr.newWindow();
    const boardId = mgr.listWorkspaces(mgr.mainWindowId)[0].boards[0].boardId;
    const targetWorkspaceId = mgr.getActiveWorkspaceId(second);
    expect(mgr.moveBoardToWorkspace(boardId, targetWorkspaceId)).toEqual({
      ok: false,
      reason: "workspace-not-found",
    });
  });

  test("showTabは持ち主のウィンドウをフォーカス中にする", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    const mainTabId = soleTabId(mgr, mgr.mainWindowId);
    const second = mgr.newWindow();
    expect(mgr.getFocusedWindowId()).toBe(second);
    expect(mgr.showTab(mainTabId)).toBe(true);
    expect(mgr.getFocusedWindowId()).toBe(mgr.mainWindowId);
  });

  test("タブ変数の横断検索は全ウィンドウを見る", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWindowManager(baseOpts({ createSession: factory }));
    const mainTabId = soleTabId(mgr, mgr.mainWindowId);
    const second = mgr.newWindow();
    const secondTabId = soleTabId(mgr, second);
    mgr.setTabVar(mainTabId, "role", "editor");
    mgr.setTabVar(secondTabId, "role", "editor");
    expect(mgr.findTabsByVar("role", "editor").sort()).toEqual([mainTabId, secondTabId].sort());
  });
});
