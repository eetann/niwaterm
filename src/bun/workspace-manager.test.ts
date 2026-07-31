import { describe, expect, test } from "bun:test";
import type { PersistedState } from "./persistence";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import type { TileLeaf, TileNode } from "./tile-layout";
import { createWorkspaceManager, type WorkspaceManagerOptions } from "./workspace-manager";

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
      paste: () => {},
      resize: () => false,
      renderState: () => ({ html: "", cursorX: 0, cursorY: 0, cursorVisible: true }),
      dumpText: () => "",
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

describe("createWorkspaceManager", () => {
  test("初期状態は単一ワークスペース・単一タイル・単一タブ", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const snap = mgr.snapshot();
    expect(snap.workspaceIds).toEqual([snap.activeWorkspaceId]);
    expect(snap.workspace.layout.kind).toBe("leaf");
  });

  test("tile/tab/workspaceのidは複数ワークスペース間で衝突しない", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    mgr.newWorkspace();
    mgr.newWorkspace();
    const ids = new Set<string>();
    for (const wid of mgr.snapshot().workspaceIds) {
      mgr.switchWorkspace(wid);
      const layout = mgr.snapshot().workspace.layout as TileLeaf;
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
  test("newWorkspaceで新規ワークスペースが増え、アクティブになる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const snap = mgr.snapshot();
    expect(snap.workspaceIds.length).toBe(2);
    expect(snap.activeWorkspaceId).not.toBe(firstId);
  });

  test("switchWorkspaceでアクティブなワークスペースの描画データが切り替わる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;
    mgr.switchWorkspace(firstId);
    expect(mgr.snapshot().activeWorkspaceId).toBe(firstId);
    mgr.switchWorkspace(secondId);
    expect(mgr.snapshot().activeWorkspaceId).toBe(secondId);
  });

  test("存在しないworkspaceIdへのswitchWorkspaceは無視される", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const activeId = mgr.snapshot().activeWorkspaceId;
    mgr.switchWorkspace("not-found");
    expect(mgr.snapshot().activeWorkspaceId).toBe(activeId);
  });

  test("closeWorkspaceで非アクティブなワークスペースを削除でき、そのセッションもdisposeされる", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;
    mgr.switchWorkspace(firstId);

    mgr.closeWorkspace(secondId);

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

  test("最後の1つのワークスペースはcloseWorkspaceしても閉じられない（誤操作防止）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const onlyId = mgr.snapshot().activeWorkspaceId;
    mgr.closeWorkspace(onlyId);
    expect(mgr.snapshot().workspaceIds).toEqual([onlyId]);
  });
});

describe("tileId/tabIdベースの操作は所属workspaceへ自動的にルーティングされる", () => {
  test("非アクティブなワークスペースのタイルへもsplitTile/newTab/closeTabが届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    mgr.newWorkspace(); // 以後、first workspaceは非アクティブ

    const newTabId = mgr.newTab(firstTileId);
    expect(newTabId).not.toBeNull();
    mgr.switchWorkspace(firstId);
    const afterNewTab = mgr.snapshot().workspace.layout as TileLeaf;
    expect(afterNewTab.tabIds.length).toBe(2);

    const splitResult = mgr.splitTile(firstTileId, "vertical");
    expect(splitResult).not.toBeNull();
    const afterSplit = mgr.snapshot().workspace.layout;
    expect(afterSplit.kind).toBe("split");
  });

  test("tabIdベースのhandleInput/handlePaste/handleResizeも所属workspaceへ届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
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

  test("focusDirectionは常にアクティブなワークスペースへルーティングされる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    const before = mgr.snapshot().workspace.focusedTileId;
    mgr.focusDirection("left");
    expect(mgr.snapshot().workspace.focusedTileId).not.toBe(before);
  });
});

describe("ワークスペースが空になった時の挙動", () => {
  test("あるワークスペースの最後のタブのプロセスが終了すると、そのワークスペースは削除されアクティブが切り替わる", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();

    created[1]?.opts.onExit?.(0);

    expect(mgr.snapshot().workspaceIds).toEqual([firstId]);
    expect(mgr.snapshot().activeWorkspaceId).toBe(firstId);
  });

  test("最後の1つのワークスペースの最後のタブが終了するとonAllWorkspacesClosedが呼ばれる", () => {
    const { created, factory } = createFakeSessionFactory();
    let allClosed = false;
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, onAllWorkspacesClosed: () => (allClosed = true) }),
    );
    void mgr;
    created[0]?.opts.onExit?.(0);
    expect(allClosed).toBe(true);
  });
});

describe("restoreFrom（永続化からの復元）", () => {
  test("workspaces配列の件数分ワークスペースが復元され、各leafの全タブ分セッションが起動する", () => {
    const { created, factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 1,
      activeWorkspaceIndex: 0,
      workspaces: [
        {
          layout: {
            kind: "split",
            direction: "row",
            ratio: 0.5,
            first: { kind: "leaf", tabCount: 1, activeTabIndex: 0 },
            second: { kind: "leaf", tabCount: 2, activeTabIndex: 1 },
          },
        },
        { layout: { kind: "leaf", tabCount: 1, activeTabIndex: 0 } },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));

    expect(mgr.snapshot().workspaceIds.length).toBe(2);
    expect(created.length).toBe(4); // 1つ目のworkspaceに3タブ、2つ目に1タブ
    expect(mgr.snapshot().workspace.layout.kind).toBe("split");
  });

  test("activeWorkspaceIndexで指定したワークスペースがアクティブになる", () => {
    const { factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 1,
      activeWorkspaceIndex: 1,
      workspaces: [
        { layout: { kind: "leaf", tabCount: 1, activeTabIndex: 0 } },
        { layout: { kind: "leaf", tabCount: 1, activeTabIndex: 0 } },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    const snap = mgr.snapshot();
    expect(snap.activeWorkspaceId).toBe(snap.workspaceIds[1]);
  });

  test("範囲外のactiveWorkspaceIndexは末尾にクランプされる", () => {
    const { factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = {
      version: 1,
      activeWorkspaceIndex: 99,
      workspaces: [
        { layout: { kind: "leaf", tabCount: 1, activeTabIndex: 0 } },
        { layout: { kind: "leaf", tabCount: 1, activeTabIndex: 0 } },
      ],
    };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    const snap = mgr.snapshot();
    expect(snap.activeWorkspaceId).toBe(snap.workspaceIds[1]);
  });

  test("workspacesが空のrestoreFromは無視され、単一ワークスペースで初期化される", () => {
    const { factory } = createFakeSessionFactory();
    const restoreFrom: PersistedState = { version: 1, activeWorkspaceIndex: 0, workspaces: [] };
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory, restoreFrom }));
    expect(mgr.snapshot().workspaceIds.length).toBe(1);
  });
});

describe("serializeForPersistence", () => {
  test("現在のワークスペース構成をPersistedStateとして書き出せる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    mgr.newWorkspace();

    const persisted = mgr.serializeForPersistence();

    expect(persisted.version).toBe(1);
    expect(persisted.workspaces.length).toBe(2);
    expect(persisted.workspaces[0]?.layout.kind).toBe("split");
    expect(persisted.workspaces[1]?.layout).toEqual({
      kind: "leaf",
      tabCount: 1,
      activeTabIndex: 0,
    });
    expect(persisted.activeWorkspaceIndex).toBe(1);
  });

  test("serializeForPersistence -> restoreFrom のラウンドトリップで同じ骨格になる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    const split = mgr.snapshot().workspace.layout as TileNode & { kind: "split" };
    mgr.newTab((split.first as TileLeaf).id);

    const persisted = mgr.serializeForPersistence();
    const restored = createWorkspaceManager(
      baseOpts({ createSession: factory, restoreFrom: persisted }),
    );

    expect(restored.serializeForPersistence()).toEqual(persisted);
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
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");

    const entry = mgr.listWorkspaces()[0];
    expect(entry?.layout).toEqual(mgr.snapshot().workspace.layout);
    expect(entry?.focusedTileId).toBe(mgr.snapshot().workspace.focusedTileId);
  });
});

describe("hasTab", () => {
  test("存在するtabIdはtrue、存在しないtabIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    expect(mgr.hasTab(tabId)).toBe(true);
    expect(mgr.hasTab("not-found")).toBe(false);
  });
});

describe("getTabText", () => {
  test("存在するtabIdはテキストを返し、存在しないtabIdはnullを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    expect(mgr.getTabText(tabId)).toBe("");
    expect(mgr.getTabText("not-found")).toBeNull();
  });

  test("非アクティブなワークスペースのタブへも届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    mgr.newWorkspace();
    expect(mgr.getTabText(firstTabId)).toBe("");
  });
});

describe("switchTab / closeTab / focusTileの戻り値", () => {
  test("switchTabは成功時true、存在しないtileId/tabIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const newTabId = mgr.newTab(tileId) as string;

    expect(mgr.switchTab(tileId, newTabId)).toBe(true);
    expect(mgr.switchTab("not-found", newTabId)).toBe(false);
    expect(mgr.switchTab(tileId, "not-found")).toBe(false);
  });

  test("closeTabは成功時true、存在しないtileId/tabIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const newTabId = mgr.newTab(tileId) as string;

    expect(mgr.closeTab("not-found", newTabId)).toBe(false);
    expect(mgr.closeTab(tileId, newTabId)).toBe(true);
  });

  test("focusTileは成功時true、存在しないtileIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;

    expect(mgr.focusTile(tileId)).toBe(true);
    expect(mgr.focusTile("not-found")).toBe(false);
  });
});
