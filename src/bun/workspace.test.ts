import { describe, expect, test } from "bun:test";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import type { TileLeaf, TileNode } from "./tile-layout";
import { createWorkspace, type WorkspaceOptions } from "./workspace";

function idGen(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
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
      paste: () => {},
      resize: () => false,
      renderState: () => ({ html: "", cursorX: 0, cursorY: 0, cursorVisible: true }),
      dispose: () => {
        record.disposed = true;
      },
    };
  };
  return { created, factory };
}

function baseOpts(
  overrides: Partial<WorkspaceOptions> & { createSession: WorkspaceOptions["createSession"] },
): WorkspaceOptions {
  return {
    initialCols: 80,
    initialRows: 24,
    genTileId: idGen("tile"),
    genTabId: idGen("tab"),
    onDirty: () => {},
    onAllTabsClosed: () => {},
    ...overrides,
  };
}

describe("initialTree（永続化からの復元）", () => {
  test("既存の木構造を渡すと、全leafの全tabId分セッションが起動する", () => {
    const { created, factory } = createFakeSessionFactory();
    const initialTree: TileNode = {
      kind: "split",
      id: "tile-restored-0",
      direction: "row",
      ratio: 0.4,
      first: {
        kind: "leaf",
        id: "tile-restored-1",
        tabIds: ["tab-restored-1"],
        activeTabId: "tab-restored-1",
      },
      second: {
        kind: "leaf",
        id: "tile-restored-2",
        tabIds: ["tab-restored-2", "tab-restored-3"],
        activeTabId: "tab-restored-3",
      },
    };
    const ws = createWorkspace(baseOpts({ createSession: factory, initialTree }));

    expect(ws.getLayout()).toEqual(initialTree);
    expect(created.length).toBe(3);
    expect(ws.hasTab("tab-restored-1")).toBe(true);
    expect(ws.hasTab("tab-restored-2")).toBe(true);
    expect(ws.hasTab("tab-restored-3")).toBe(true);
  });

  test("focusedTileIdは最初のleafになる", () => {
    const { factory } = createFakeSessionFactory();
    const initialTree: TileNode = {
      kind: "split",
      id: "tile-restored-0",
      direction: "row",
      ratio: 0.5,
      first: {
        kind: "leaf",
        id: "tile-restored-1",
        tabIds: ["tab-restored-1"],
        activeTabId: "tab-restored-1",
      },
      second: {
        kind: "leaf",
        id: "tile-restored-2",
        tabIds: ["tab-restored-2"],
        activeTabId: "tab-restored-2",
      },
    };
    const ws = createWorkspace(baseOpts({ createSession: factory, initialTree }));
    expect(ws.snapshot().focusedTileId).toBe("tile-restored-1");
  });
});

describe("newTab", () => {
  test("対象タイルにタブを追加し、新規セッションが起動して active になる", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    ws.newTab(before.id);
    const after = ws.snapshot().layout as TileLeaf;
    expect(after.tabIds.length).toBe(2);
    expect(after.activeTabId).toBe(after.tabIds[1]);
    expect(created.length).toBe(2);
    expect(Object.keys(ws.snapshot().tabs).length).toBe(2);
  });

  test("存在しないtileIdは無視される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    ws.newTab("not-found");
    expect(ws.snapshot().layout).toEqual(before);
  });
});

describe("switchTab", () => {
  test("tabIdsに存在するタブへactiveTabIdが切り替わる", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    const firstTabId = (ws.snapshot().layout as TileLeaf).tabIds[0];
    ws.switchTab(tileId, firstTabId);
    expect((ws.snapshot().layout as TileLeaf).activeTabId).toBe(firstTabId);
  });

  test("存在しないtabIdは無視される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    ws.switchTab(before.id, "not-a-tab");
    expect((ws.snapshot().layout as TileLeaf).activeTabId).toBe(before.activeTabId);
  });
});

describe("closeTab", () => {
  test("複数タブのうち1つを閉じるとそのセッションだけdisposeされ、タイルは残る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    const leaf = ws.snapshot().layout as TileLeaf;
    const [firstTabId, secondTabId] = leaf.tabIds;
    ws.closeTab(tileId, firstTabId);

    const after = ws.snapshot().layout as TileLeaf;
    expect(after.tabIds).toEqual([secondTabId]);
    expect(created[0]?.disposed).toBe(true);
    expect(Object.keys(ws.snapshot().tabs)).toEqual([secondTabId]);
  });

  test("タイル内最後のタブを閉じると兄弟タイルが畳まれる", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.splitTile(firstTileId, "vertical");
    const splitTree = ws.snapshot().layout;
    expect(splitTree.kind).toBe("split");
    const secondLeaf = (splitTree as typeof splitTree & { kind: "split" }).second as TileLeaf;

    ws.closeTab(secondLeaf.id, secondLeaf.activeTabId);

    const after = ws.snapshot().layout;
    expect(after.kind).toBe("leaf");
    expect((after as TileLeaf).id).toBe(firstTileId);
  });

  test("ワークスペース最後の1枚のタイルの最後のタブは閉じられない（誤操作防止）", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const leaf = ws.snapshot().layout as TileLeaf;
    ws.closeTab(leaf.id, leaf.activeTabId);
    expect(ws.snapshot().layout).toEqual(leaf);
  });
});

describe("シェルプロセス終了時の挙動(onExit経由)", () => {
  test("複数タブがあるタイルで1つのプロセスが終了しても、そのタブだけ消えタイルは残る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    const leaf = ws.snapshot().layout as TileLeaf;
    const [firstTabId] = leaf.tabIds;

    created[0]?.opts.onExit?.(0);

    const after = ws.snapshot().layout as TileLeaf;
    expect(after.tabIds).not.toContain(firstTabId);
    expect(after.tabIds.length).toBe(1);
  });

  test("ワークスペース最後の1枚・最後のタブのプロセスが終了するとonAllTabsClosedが呼ばれる", () => {
    const { created, factory } = createFakeSessionFactory();
    let allClosed = false;
    const ws = createWorkspace(
      baseOpts({ createSession: factory, onAllTabsClosed: () => (allClosed = true) }),
    );
    void ws;
    created[0]?.opts.onExit?.(0);
    expect(allClosed).toBe(true);
  });
});
