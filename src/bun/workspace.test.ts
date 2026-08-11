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
      renderState: () => ({
        kind: "terminal",
        html: "",
        cursorX: 0,
        cursorY: 0,
        cursorVisible: true,
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

describe("NIWATERM_TILE_ID環境変数の注入", () => {
  test("初期タブのセッションには所属タイルのtileIdがNIWATERM_TILE_IDとして渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    expect(created[0]?.opts.env).toEqual({ NIWATERM_TILE_ID: tileId });
  });

  test("splitTileで生成される新タイルのセッションには新tileIdが渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    const result = ws.splitTile(firstTileId, "vertical");
    expect(result).not.toBeNull();
    expect(created[1]?.opts.env).toEqual({ NIWATERM_TILE_ID: result?.tileId as string });
  });

  test("newTabで既存タイルに追加されるセッションには同一tileIdが渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    expect(created[1]?.opts.env).toEqual({ NIWATERM_TILE_ID: tileId });
  });
});

describe("getDefaultShellによるシェル指定", () => {
  test("getDefaultShell省略時はshellがundefinedのまま渡る（pty.ts側のOS標準にフォールバック）", () => {
    const { created, factory } = createFakeSessionFactory();
    createWorkspace(baseOpts({ createSession: factory }));
    expect(created[0]?.opts.shell).toBeUndefined();
  });

  test("getDefaultShellが返す値が初期タブのセッションへshellとして渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    createWorkspace(baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }));
    expect(created[0]?.opts.shell).toBe("/bin/bash");
  });

  test("splitTile/newTabで生成されるセッションにもgetDefaultShellの値が渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(
      baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }),
    );
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    expect(created[1]?.opts.shell).toBe("/bin/bash");
  });

  test("getDefaultShellは呼び出し毎に評価される（ホットリロードで変わった値が新規タブへ反映される）", () => {
    const { created, factory } = createFakeSessionFactory();
    let current = "/bin/bash";
    const ws = createWorkspace(
      baseOpts({ createSession: factory, getDefaultShell: () => current }),
    );
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    current = "/bin/fish";
    ws.newTab(tileId);
    expect(created[0]?.opts.shell).toBe("/bin/bash");
    expect(created[1]?.opts.shell).toBe("/bin/fish");
  });
});

describe("splitTile", () => {
  test("対象タイルを分割し、新規tileId/tabIdを返す", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    const result = ws.splitTile(firstTileId, "vertical");
    expect(result).not.toBeNull();
    const splitTree = ws.snapshot().layout;
    expect(splitTree.kind).toBe("split");
    const secondLeaf = (splitTree as typeof splitTree & { kind: "split" }).second as TileLeaf;
    expect(result?.tileId).toBe(secondLeaf.id);
    expect(result?.tabId).toBe(secondLeaf.activeTabId);
    expect(created.length).toBe(2);
  });

  test("存在しないtileIdはnullを返し、木構造は変わらない", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.splitTile("not-found", "vertical");
    expect(result).toBeNull();
    expect(ws.snapshot().layout).toEqual(before);
  });
});

describe("newTab", () => {
  test("対象タイルにタブを追加し、新規セッションが起動して active になる。戻り値は新規tabId", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.newTab(before.id);
    const after = ws.snapshot().layout as TileLeaf;
    expect(after.tabIds.length).toBe(2);
    expect(after.activeTabId).toBe(after.tabIds[1]);
    expect(result).toBe(after.activeTabId);
    expect(created.length).toBe(2);
    expect(Object.keys(ws.snapshot().tabs).length).toBe(2);
  });

  test("存在しないtileIdはnullを返し、無視される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.newTab("not-found");
    expect(result).toBeNull();
    expect(ws.snapshot().layout).toEqual(before);
  });

  test("shellOverrideを渡すとgetDefaultShellより優先してそのタブのセッションへ渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(
      baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }),
    );
    const before = ws.snapshot().layout as TileLeaf;
    ws.newTab(before.id, "wsl.exe -d Ubuntu");
    expect(created[1]?.opts.shell).toBe("wsl.exe -d Ubuntu");
    // 初期タブはgetDefaultShellのまま（shellOverrideは今回のnewTab呼び出しのみに効く）
    expect(created[0]?.opts.shell).toBe("/bin/bash");
  });
});

describe("newBrowserTab", () => {
  test("対象タイルにタブを追加するが、PTYセッションは増やさない。snapshotはkind:browserを返す", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.newBrowserTab(before.id, "https://example.com");
    const after = ws.snapshot().layout as TileLeaf;
    expect(after.tabIds.length).toBe(2);
    expect(after.activeTabId).toBe(after.tabIds[1]);
    expect(result).toBe(after.activeTabId);
    expect(created.length).toBe(1); // PTYセッションは増えない
    expect(ws.snapshot().tabs[after.activeTabId]).toEqual({
      kind: "browser",
      url: "https://example.com",
    });
  });

  test("hasTabはfalseのまま（PTYセッションを持たないため）", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.newBrowserTab(before.id, "https://example.com") as string;
    expect(ws.hasTab(result)).toBe(false);
  });

  test("closeTabで閉じるとtabsから消える", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const tabId = ws.newBrowserTab(tileId, "https://example.com") as string;
    const result = ws.closeTab(tileId, tabId);
    expect(result).toBe(true);
    expect(ws.snapshot().tabs[tabId]).toBeUndefined();
  });

  test("存在しないtileIdはnullを返し、無視される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.newBrowserTab("not-found", "https://example.com");
    expect(result).toBeNull();
    expect(ws.snapshot().layout).toEqual(before);
  });
});

describe("switchTab", () => {
  test("tabIdsに存在するタブへactiveTabIdが切り替わり、trueを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    const firstTabId = (ws.snapshot().layout as TileLeaf).tabIds[0];
    const result = ws.switchTab(tileId, firstTabId);
    expect(result).toBe(true);
    expect((ws.snapshot().layout as TileLeaf).activeTabId).toBe(firstTabId);
  });

  test("存在しないtabIdはfalseを返し、無視される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.switchTab(before.id, "not-a-tab");
    expect(result).toBe(false);
    expect((ws.snapshot().layout as TileLeaf).activeTabId).toBe(before.activeTabId);
  });
});

describe("closeTab", () => {
  test("複数タブのうち1つを閉じるとそのセッションだけdisposeされ、タイルは残る。戻り値はtrue", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    const leaf = ws.snapshot().layout as TileLeaf;
    const [firstTabId, secondTabId] = leaf.tabIds;
    const result = ws.closeTab(tileId, firstTabId);

    expect(result).toBe(true);
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

  test("ワークスペース最後の1枚のタイルの最後のタブは閉じられない（誤操作防止）。戻り値はfalse", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const leaf = ws.snapshot().layout as TileLeaf;
    const result = ws.closeTab(leaf.id, leaf.activeTabId);
    expect(result).toBe(false);
    expect(ws.snapshot().layout).toEqual(leaf);
  });
});

describe("findTileIdForTab / hasBrowserTab", () => {
  test("findTileIdForTabはterminalタブ・browserタブいずれの所属tileIdも返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const terminalTabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    const browserTabId = ws.newBrowserTab(tileId, "https://example.com") as string;

    expect(ws.findTileIdForTab(terminalTabId)).toBe(tileId);
    expect(ws.findTileIdForTab(browserTabId)).toBe(tileId);
  });

  test("findTileIdForTabは存在しないtabIdはnullを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    expect(ws.findTileIdForTab("not-found")).toBeNull();
  });

  test("hasBrowserTabはbrowserタブのみtrue、terminalタブ・不存在はfalse", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const terminalTabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    const browserTabId = ws.newBrowserTab(tileId, "https://example.com") as string;

    expect(ws.hasBrowserTab(browserTabId)).toBe(true);
    expect(ws.hasBrowserTab(terminalTabId)).toBe(false);
    expect(ws.hasBrowserTab("not-found")).toBe(false);
  });
});

describe("getTabText", () => {
  test("存在するtabIdはセッションのdumpTextの結果を返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    expect(ws.getTabText(tabId)).toBe("");
  });

  test("存在しないtabIdはnullを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    expect(ws.getTabText("not-found")).toBeNull();
  });
});

describe("focusTile", () => {
  test("存在するtileIdへfocusedTileIdが切り替わり、trueを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.splitTile(firstTileId, "vertical");
    const result = ws.focusTile(firstTileId);
    expect(result).toBe(true);
    expect(ws.snapshot().focusedTileId).toBe(firstTileId);
  });

  test("存在しないtileIdはfalseを返し、focusedTileIdは変わらない", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const before = ws.snapshot().focusedTileId;
    const result = ws.focusTile("not-found");
    expect(result).toBe(false);
    expect(ws.snapshot().focusedTileId).toBe(before);
  });
});

describe("タイル変数(setTileVar/getTileVar/listTileVars)", () => {
  test("set→getで同じ値が返る。上書きもできる", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;

    expect(ws.setTileVar(tileId, "status", "running")).toBe(true);
    expect(ws.getTileVar(tileId, "status")).toEqual({ found: true, value: "running" });

    expect(ws.setTileVar(tileId, "status", "done")).toBe(true);
    expect(ws.getTileVar(tileId, "status")).toEqual({ found: true, value: "done" });
  });

  test("未設定キーはfound:false, reason:not-set", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    expect(ws.getTileVar(tileId, "not-set-key")).toEqual({ found: false, reason: "not-set" });
  });

  test("listTileVarsは設定済みの全キーを返す。未設定なら空オブジェクト", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;

    expect(ws.listTileVars(tileId)).toEqual({});
    ws.setTileVar(tileId, "a", "1");
    ws.setTileVar(tileId, "b", "2");
    expect(ws.listTileVars(tileId)).toEqual({ a: "1", b: "2" });
  });

  test("存在しないtileIdはsetがfalse、getがtile-not-found、listがnull", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    expect(ws.setTileVar("not-found", "k", "v")).toBe(false);
    expect(ws.getTileVar("not-found", "k")).toEqual({ found: false, reason: "tile-not-found" });
    expect(ws.listTileVars("not-found")).toBeNull();
  });

  test("split（leafでないtileId）はtile-not-found扱い", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.splitTile(firstTileId, "vertical");
    const splitId = ws.snapshot().layout.id;
    expect(ws.setTileVar(splitId, "k", "v")).toBe(false);
    expect(ws.listTileVars(splitId)).toBeNull();
  });

  test("closeTabでタイル自体が閉じられると変数も消える", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.splitTile(firstTileId, "vertical");
    const splitTree = ws.snapshot().layout;
    const secondLeaf = (splitTree as typeof splitTree & { kind: "split" }).second as TileLeaf;

    ws.setTileVar(secondLeaf.id, "k", "v");
    ws.closeTab(secondLeaf.id, secondLeaf.activeTabId);

    expect(ws.getTileVar(secondLeaf.id, "k")).toEqual({ found: false, reason: "tile-not-found" });
  });

  test("タイル内の複数タブのうち1つを閉じただけ（タイル自体は残る）では変数は消えない", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createWorkspace(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    ws.setTileVar(tileId, "k", "v");
    const leaf = ws.snapshot().layout as TileLeaf;
    const [firstTabId] = leaf.tabIds;

    ws.closeTab(tileId, firstTabId);

    expect(ws.getTileVar(tileId, "k")).toEqual({ found: true, value: "v" });
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
