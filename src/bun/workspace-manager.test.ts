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
      scroll: () => {},
      scrollToTop: () => {},
      scrollToBottom: () => {},
      renderState: () => ({
        kind: "terminal",
        html: "",
        cursorX: 0,
        cursorY: 0,
        cursorVisible: true,
        viewportPinned: true,
      }),
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

describe("getDefaultShellの配線", () => {
  test("getDefaultShellが返す値がworkspace.tsまで届き、初期タブのセッションへshellとして渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    createWorkspaceManager(
      baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }),
    );
    expect(created[0]?.opts.shell).toBe("/bin/bash");
  });

  test("newTabにshellOverrideを渡すとworkspace.tsまで届き、そのタブのセッションへ優先して渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(
      baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }),
    );
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
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

  test("非アクティブなワークスペースのタイルへもnewBrowserTabが届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    mgr.newWorkspace(); // 以後、first workspaceは非アクティブ

    const newTabId = mgr.newBrowserTab(firstTileId, "https://example.com");
    expect(newTabId).not.toBeNull();
    mgr.switchWorkspace(firstId);
    expect(mgr.snapshot().workspace.tabs[newTabId as string]).toEqual({
      kind: "browser",
      url: "https://example.com",
    });
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

describe("タブ変数(setTabVar/getTabVar/listTabVars)", () => {
  test("非アクティブなワークスペースのタブへも届く", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    mgr.newWorkspace(); // 以後、firstTabId所属のworkspaceは非アクティブ

    expect(mgr.setTabVar(firstTabId, "status", "running")).toBe(true);
    expect(mgr.getTabVar(firstTabId, "status")).toEqual({ found: true, value: "running" });
    expect(mgr.listTabVars(firstTabId)).toEqual({ status: "running" });
  });

  test("タブAが書いた変数をタブBから読める（tabIdを指定すれば所属workspaceに関わらずアクセスできる）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileA = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
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
    const tileA = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
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
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
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

describe("タブ名・タイル名(setTabName/setTileName)", () => {
  test("setTabNameで設定した名前がlistWorkspaces()のtabNamesに反映される", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;

    expect(mgr.setTabName(tabId, "roadmap")).toBe(true);

    expect(mgr.listWorkspaces()[0]?.tabNames).toEqual({ [tabId]: "roadmap" });
  });

  test("setTileNameで設定した名前がlistWorkspaces()のtileNamesに反映される", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;

    expect(mgr.setTileName(tileId, "作業ペイン")).toBe(true);

    expect(mgr.listWorkspaces()[0]?.tileNames).toEqual({ [tileId]: "作業ペイン" });
  });

  test("空文字列を設定すると名前がクリアされデフォルトへ戻る", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;

    mgr.setTabName(tabId, "roadmap");
    mgr.setTabName(tabId, "");

    expect(mgr.listWorkspaces()[0]?.tabNames).toEqual({});
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
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    mgr.newWorkspace(); // 以後、firstTileId/firstTabId所属のworkspaceは非アクティブ

    expect(mgr.setTabName(firstTabId, "roadmap")).toBe(true);
    expect(mgr.setTileName(firstTileId, "作業ペイン")).toBe(true);
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

  test("snapshot().workspacesはlistWorkspaces()と一致する（サイドバー描画用データ）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    mgr.newWorkspace();

    expect(mgr.snapshot().workspaces).toEqual(mgr.listWorkspaces());
  });

  test("tabVarsに各タブのタブ変数がtabIdをキーに含まれる（未設定なら空オブジェクト）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    const split = mgr.splitTile(firstTileId, "vertical");
    mgr.setTabVar(firstTabId, "branch", "main");

    const entry = mgr.listWorkspaces()[0];
    expect(entry?.tabVars).toEqual({
      [firstTabId]: { branch: "main" },
      [split?.tabId as string]: {},
    });
  });

  test("1タイル内に複数タブがあると、tabVarsのキーはタイル単位ではなくタブ単位で並ぶ", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    const secondTabId = mgr.newTab(tileId) as string;
    mgr.setTabVar(firstTabId, "agent_status", "working");
    mgr.setTabVar(secondTabId, "agent_status", "idle");

    const entry = mgr.listWorkspaces()[0];
    expect(entry?.tabVars).toEqual({
      [firstTabId]: { agent_status: "working" },
      [secondTabId]: { agent_status: "idle" },
    });
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

describe("locateTab / locateBrowserTab / isWorkspaceActive", () => {
  test("locateTabは種別問わず所在workspaceId/tileIdを返す。非アクティブなワークスペースでも見つかる", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const terminalTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    const browserTabId = mgr.newBrowserTab(firstTileId, "https://example.com") as string;
    mgr.newWorkspace(); // 以後、firstIdは非アクティブ

    expect(mgr.locateTab(terminalTabId)).toEqual({ workspaceId: firstId, tileId: firstTileId });
    expect(mgr.locateTab(browserTabId)).toEqual({ workspaceId: firstId, tileId: firstTileId });
    expect(mgr.locateTab("not-found")).toBeNull();
  });

  test("locateBrowserTabはbrowserタブのみ所在を返し、terminalタブはnull", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const terminalTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    const browserTabId = mgr.newBrowserTab(firstTileId, "https://example.com") as string;

    expect(mgr.locateBrowserTab(browserTabId)).toEqual({
      workspaceId: firstId,
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

describe("moveTab", () => {
  test("同一workspace内のタイル間移動は成功する", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const movingTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    const split = mgr.splitTile(firstTileId, "vertical") as { tileId: string };

    const result = mgr.moveTab(firstTileId, movingTabId, split.tileId);

    expect(result).toBe(true);
    const after = mgr.snapshot().workspace.layout;
    expect(after.kind).toBe("leaf");
    expect((after as TileLeaf).tabIds).toContain(movingTabId);
  });

  test("別workspaceのtileId同士の移動はfalseを返し、木は変化しない（PTYセッションを移管できないため非対応）", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
    mgr.newWorkspace();
    const secondTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;

    const result = mgr.moveTab(firstTileId, firstTabId, secondTileId);

    expect(result).toBe(false);
    mgr.switchWorkspace(firstId);
    expect((mgr.snapshot().workspace.layout as TileLeaf).tabIds).toEqual([firstTabId]);
  });

  test("存在しないtileIdはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const mgr = createWorkspaceManager(baseOpts({ createSession: factory }));
    const leaf = mgr.snapshot().workspace.layout as TileLeaf;

    expect(mgr.moveTab("not-found", leaf.activeTabId, leaf.id)).toBe(false);
    expect(mgr.moveTab(leaf.id, leaf.activeTabId, "not-found")).toBe(false);
  });
});
