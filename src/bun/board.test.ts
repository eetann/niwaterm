import { describe, expect, test } from "bun:test";
import type { PersistedTab, RestoredTreeMeta } from "./persistence";
import type {
  TerminalSession,
  TerminalSessionCallbacks,
  TerminalSessionOptions,
} from "./terminal-session";
import type { TileLeaf, TileNode } from "./tile-layout";
import { createBoard, type BoardOptions } from "./board";

function idGen(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

interface FakeSessionRecord {
  opts: TerminalSessionOptions;
  disposed: boolean;
  /** setCallbacksで差し替わった最新のコールバック。テストからtriggerExit/triggerPwdChangedで発火する */
  callbacks: TerminalSessionCallbacks;
}

function createFakeSessionFactory() {
  const created: FakeSessionRecord[] = [];
  const factory = (opts: TerminalSessionOptions): TerminalSession => {
    const record: FakeSessionRecord = {
      opts,
      disposed: false,
      callbacks: { onOutput: opts.onOutput, onExit: opts.onExit, onPwdChanged: opts.onPwdChanged },
    };
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
      setCallbacks: (next) => {
        record.callbacks = next;
      },
      dispose: () => {
        record.disposed = true;
      },
    };
  };
  return { created, factory };
}

function baseOpts(
  overrides: Partial<BoardOptions> & { createSession: BoardOptions["createSession"] },
): BoardOptions {
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
    const ws = createBoard(baseOpts({ createSession: factory, initialTree }));

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
    const ws = createBoard(baseOpts({ createSession: factory, initialTree }));
    expect(ws.snapshot().focusedTileId).toBe("tile-restored-1");
  });
});

describe("restoredMeta（永続化からのメタ情報復元）", () => {
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
      tabIds: ["tab-restored-2"],
      activeTabId: "tab-restored-2",
    },
  };

  test("terminalタブのshell/name/vars（cwd以外）がspawnされたセッションとws側の状態へ反映される", () => {
    const { created, factory } = createFakeSessionFactory();
    const tabMeta = new Map<string, PersistedTab>([
      [
        "tab-restored-1",
        { kind: "terminal", shell: "wsl.exe -d NixOS", name: "work", vars: { agent: "claude" } },
      ],
    ]);
    const restoredMeta: RestoredTreeMeta = { tabMeta, tileNames: new Map(), focusedTileId: null };
    const ws = createBoard(baseOpts({ createSession: factory, initialTree, restoredMeta }));

    expect(created[0]?.opts.shell).toBe("wsl.exe -d NixOS");
    expect(ws.listTabNames()).toEqual({ "tab-restored-1": "work" });
    expect(ws.getTabVar("tab-restored-1", "agent")).toEqual({ found: true, value: "claude" });
  });

  test("vars.cwdがあればresolveActualCwd適用後の値がspawnSessionのcwdに渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const tabMeta = new Map<string, PersistedTab>([
      ["tab-restored-1", { kind: "terminal", vars: { cwd: "/home/eetann/project" } }],
    ]);
    const restoredMeta: RestoredTreeMeta = { tabMeta, tileNames: new Map(), focusedTileId: null };
    createBoard(baseOpts({ createSession: factory, initialTree, restoredMeta }));

    expect(created[0]?.opts.cwd).toBe("/home/eetann/project");
  });

  test("vars.cwdが無ければgetDefaultCwd()にフォールバックする", () => {
    const { created, factory } = createFakeSessionFactory();
    const tabMeta = new Map<string, PersistedTab>([["tab-restored-1", { kind: "terminal" }]]);
    const restoredMeta: RestoredTreeMeta = { tabMeta, tileNames: new Map(), focusedTileId: null };
    createBoard(
      baseOpts({
        createSession: factory,
        initialTree,
        restoredMeta,
        getDefaultCwd: () => "/home/eetann",
      }),
    );

    expect(created[0]?.opts.cwd).toBe("/home/eetann");
  });

  test("browserタブはPTYセッションを増やさず、hasBrowserTab/snapshotへ反映される", () => {
    const { created, factory } = createFakeSessionFactory();
    const tabMeta = new Map<string, PersistedTab>([
      ["tab-restored-2", { kind: "browser", url: "https://example.com" }],
    ]);
    const restoredMeta: RestoredTreeMeta = { tabMeta, tileNames: new Map(), focusedTileId: null };
    const ws = createBoard(baseOpts({ createSession: factory, initialTree, restoredMeta }));

    expect(created.length).toBe(1); // tab-restored-1のみ（terminal、メタ情報なし）
    expect(ws.hasBrowserTab("tab-restored-2")).toBe(true);
    expect(ws.snapshot().tabs["tab-restored-2"]).toEqual({
      kind: "browser",
      url: "https://example.com",
    });
  });

  test("タイル名がws.listTileNames()へ反映される", () => {
    const { factory } = createFakeSessionFactory();
    const tileNames = new Map([["tile-restored-2", "browser-pane"]]);
    const restoredMeta: RestoredTreeMeta = { tabMeta: new Map(), tileNames, focusedTileId: null };
    const ws = createBoard(baseOpts({ createSession: factory, initialTree, restoredMeta }));

    expect(ws.listTileNames()).toEqual({ "tile-restored-2": "browser-pane" });
  });

  test("focusedTileIdが木に存在するleafを指す場合、そのleafがフォーカスされる", () => {
    const { factory } = createFakeSessionFactory();
    const restoredMeta: RestoredTreeMeta = {
      tabMeta: new Map(),
      tileNames: new Map(),
      focusedTileId: "tile-restored-2",
    };
    const ws = createBoard(baseOpts({ createSession: factory, initialTree, restoredMeta }));

    expect(ws.snapshot().focusedTileId).toBe("tile-restored-2");
  });

  test("focusedTileIdが木に存在しない場合は先頭leafにフォールバックする", () => {
    const { factory } = createFakeSessionFactory();
    const restoredMeta: RestoredTreeMeta = {
      tabMeta: new Map(),
      tileNames: new Map(),
      focusedTileId: "not-found",
    };
    const ws = createBoard(baseOpts({ createSession: factory, initialTree, restoredMeta }));

    expect(ws.snapshot().focusedTileId).toBe("tile-restored-1");
  });
});

describe("NIWATERM_TAB_ID環境変数の注入", () => {
  test("初期タブのセッションには自身のtabIdがNIWATERM_TAB_IDとして渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    expect(created[0]?.opts.env).toEqual({ NIWATERM_TAB_ID: tabId });
  });

  test("splitTileで生成される新タブのセッションには新tabIdが渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    const result = ws.splitTile(firstTileId, "vertical");
    expect(result).not.toBeNull();
    expect(created[1]?.opts.env).toEqual({ NIWATERM_TAB_ID: result?.tabId as string });
  });

  test("newTabで既存タイルに追加されるセッションには新規タブ自身のtabIdが渡る（同一タイル内の既存タブとは異なる値）", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const firstTabEnv = created[0]?.opts.env;
    const newTabId = ws.newTab(tileId) as string;
    expect(created[1]?.opts.env).toEqual({ NIWATERM_TAB_ID: newTabId });
    expect(created[1]?.opts.env).not.toEqual(firstTabEnv);
  });
});

describe("getDefaultShellによるシェル指定", () => {
  test("getDefaultShell省略時はshellがundefinedのまま渡る（pty.ts側のOS標準にフォールバック）", () => {
    const { created, factory } = createFakeSessionFactory();
    createBoard(baseOpts({ createSession: factory }));
    expect(created[0]?.opts.shell).toBeUndefined();
  });

  test("getDefaultShellが返す値が初期タブのセッションへshellとして渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    createBoard(baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }));
    expect(created[0]?.opts.shell).toBe("/bin/bash");
  });

  test("splitTile/newTabで生成されるセッションにもgetDefaultShellの値が渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(
      baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }),
    );
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    expect(created[1]?.opts.shell).toBe("/bin/bash");
  });

  test("getDefaultShellは呼び出し毎に評価される（ホットリロードで変わった値が新規タブへ反映される）", () => {
    const { created, factory } = createFakeSessionFactory();
    let current = "/bin/bash";
    const ws = createBoard(baseOpts({ createSession: factory, getDefaultShell: () => current }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    current = "/bin/fish";
    ws.newTab(tileId);
    expect(created[0]?.opts.shell).toBe("/bin/bash");
    expect(created[1]?.opts.shell).toBe("/bin/fish");
  });
});

describe("getDefaultCwdによる新規Boardのcwd指定", () => {
  test("getDefaultCwd省略時はcwdがundefinedのまま渡る（pty.ts側のOS標準ホームディレクトリにフォールバック）", () => {
    const { created, factory } = createFakeSessionFactory();
    createBoard(baseOpts({ createSession: factory }));
    expect(created[0]?.opts.cwd).toBeUndefined();
  });

  test("getDefaultCwdが返す値が初期タブのセッションへcwdとして渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    createBoard(baseOpts({ createSession: factory, getDefaultCwd: () => "/home/eetann/projects" }));
    expect(created[0]?.opts.cwd).toBe("/home/eetann/projects");
  });

  test("initialCwdを明示指定した場合はgetDefaultCwdより優先される", () => {
    const { created, factory } = createFakeSessionFactory();
    createBoard(
      baseOpts({
        createSession: factory,
        initialCwd: "/explicit/cwd",
        getDefaultCwd: () => "/home/eetann/projects",
      }),
    );
    expect(created[0]?.opts.cwd).toBe("/explicit/cwd");
  });

  test("splitTile/newTabで生成されるセッションにはgetDefaultCwdの値は渡らない（前のタブのcwdを継承する既存挙動を優先）", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(
      baseOpts({ createSession: factory, getDefaultCwd: () => "/home/eetann/projects" }),
    );
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    expect(created[1]?.opts.cwd).toBeUndefined();
  });
});

describe("splitTile", () => {
  test("対象タイルを分割し、新規tileId/tabIdを返す", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
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
    const ws = createBoard(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.splitTile("not-found", "vertical");
    expect(result).toBeNull();
    expect(ws.snapshot().layout).toEqual(before);
  });

  test("ratioを渡すとその比率でsplitされる。省略時は0.5", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.splitTile(firstTileId, "vertical", 0.7);
    const splitTree = ws.snapshot().layout as TileNode & { kind: "split" };
    expect(splitTree.ratio).toBe(0.7);

    const { factory: factory2 } = createFakeSessionFactory();
    const ws2 = createBoard(baseOpts({ createSession: factory2 }));
    const secondTileId = (ws2.snapshot().layout as TileLeaf).id;
    ws2.splitTile(secondTileId, "vertical");
    const splitTree2 = ws2.snapshot().layout as TileNode & { kind: "split" };
    expect(splitTree2.ratio).toBe(0.5);
  });
});

describe("newTab", () => {
  test("対象タイルにタブを追加し、新規セッションが起動して active になる。戻り値は新規tabId", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
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
    const ws = createBoard(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.newTab("not-found");
    expect(result).toBeNull();
    expect(ws.snapshot().layout).toEqual(before);
  });

  test("shellOverrideを渡すとgetDefaultShellより優先してそのタブのセッションへ渡る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(
      baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }),
    );
    const before = ws.snapshot().layout as TileLeaf;
    ws.newTab(before.id, "wsl.exe -d Ubuntu");
    expect(created[1]?.opts.shell).toBe("wsl.exe -d Ubuntu");
    // 初期タブはgetDefaultShellのまま（shellOverrideは今回のnewTab呼び出しのみに効く）
    expect(created[0]?.opts.shell).toBe("/bin/bash");
  });

  test("cwdを渡すとそのタブのセッションへ渡る。初期タブはcwd未指定のまま", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    ws.newTab(before.id, undefined, "/tmp/project");
    expect(created[1]?.opts.cwd).toBe("/tmp/project");
    expect(created[0]?.opts.cwd).toBeUndefined();
  });
});

describe("resizeTileInDirection", () => {
  test("first側のleafをrightへ拡大すると祖先splitのratioが増える", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.splitTile(firstTileId, "vertical"); // vertical=row split, ratio 0.5
    const ok = ws.resizeTileInDirection(firstTileId, "right", 0.1);
    expect(ok).toBe(true);
    const tree = ws.snapshot().layout as TileNode & { kind: "split" };
    expect(tree.ratio).toBeCloseTo(0.6);
  });

  test("軸が一致する祖先splitが無い場合はfalseで木構造は変わらない", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.splitTile(firstTileId, "vertical"); // rowのみ存在、column方向のsplitは無い
    const before = ws.snapshot().layout;
    const ok = ws.resizeTileInDirection(firstTileId, "up", 0.1);
    expect(ok).toBe(false);
    expect(ws.snapshot().layout).toEqual(before);
  });

  test("存在しないtileIdはfalse", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    expect(ws.resizeTileInDirection("not-found", "right", 0.1)).toBe(false);
  });
});

describe("respawnTab", () => {
  test("既存セッションをdisposeし、同じtabId・タイル位置で新しいセッションを起動する", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const tabId = before.activeTabId;
    const ok = ws.respawnTab(tabId);
    expect(ok).toBe(true);
    expect(created[0]?.disposed).toBe(true);
    expect(created.length).toBe(2);
    const after = ws.snapshot().layout as TileLeaf;
    expect(after.activeTabId).toBe(tabId);
    expect(after.tabIds).toEqual([tabId]);
  });

  test("shellOverride/cwd/commandを渡すと新しいセッションへ反映される", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    ws.respawnTab(tabId, "wsl.exe -d Ubuntu", "/tmp/project", "lazygit");
    expect(created[1]?.opts.shell).toBe("wsl.exe -d Ubuntu");
    expect(created[1]?.opts.cwd).toBe("/tmp/project");
    expect(created[1]?.opts.command).toBe("lazygit");
  });

  test("cwd省略時はOSC7報告済みの直前のcwdを引き継ぐ", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    created[0]?.opts.onPwdChanged?.("/tmp/reported");
    ws.respawnTab(tabId);
    expect(created[1]?.opts.cwd).toBe("/tmp/reported");
  });

  test("存在しないtabIdはfalse", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    expect(ws.respawnTab("not-found")).toBe(false);
  });

  test("ブラウザタブはfalse（respawn対象外）", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const browserTabId = ws.newBrowserTab(tileId, "https://example.com");
    expect(ws.respawnTab(browserTabId as string)).toBe(false);
  });
});

describe("OSC7（onPwdChanged）によるcwd自動反映", () => {
  test("onPwdChangedが呼ばれるとtabVarsの'cwd'へ反映される", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    created[0]?.opts.onPwdChanged?.("/home/user/project");
    expect(ws.getTabVar(tabId, "cwd")).toEqual({ found: true, value: "/home/user/project" });
  });

  test("newTabでcwd省略時、対象タイルのアクティブタブが報告済みのcwdをデフォルトとして使う", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    created[0]?.opts.onPwdChanged?.("/home/user/project");
    ws.newTab(tileId);
    expect(created[1]?.opts.cwd).toBe("/home/user/project");
  });

  test("newTabでcwdを明示指定した場合は報告済みのcwdより優先する", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    created[0]?.opts.onPwdChanged?.("/home/user/project");
    ws.newTab(tileId, undefined, "/explicit/dir");
    expect(created[1]?.opts.cwd).toBe("/explicit/dir");
  });

  test("splitTileでもcwd省略時、分割元タイルのアクティブタブが報告済みのcwdをデフォルトとして使う", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    created[0]?.opts.onPwdChanged?.("/home/user/project");
    ws.splitTile(tileId, "vertical");
    expect(created[1]?.opts.cwd).toBe("/home/user/project");
  });

  test("報告が無いタブを対象にnewTab/splitTileしてもcwdはundefinedのまま", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    expect(created[1]?.opts.cwd).toBeUndefined();
  });
});

describe("newBrowserTab", () => {
  test("対象タイルにタブを追加するが、PTYセッションは増やさない。snapshotはkind:browserを返す", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
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
    const ws = createBoard(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.newBrowserTab(before.id, "https://example.com") as string;
    expect(ws.hasTab(result)).toBe(false);
  });

  test("closeTabで閉じるとtabsから消える", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const tabId = ws.newBrowserTab(tileId, "https://example.com") as string;
    const result = ws.closeTab(tileId, tabId);
    expect(result).toBe(true);
    expect(ws.snapshot().tabs[tabId]).toBeUndefined();
  });

  test("存在しないtileIdはnullを返し、無視される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.newBrowserTab("not-found", "https://example.com");
    expect(result).toBeNull();
    expect(ws.snapshot().layout).toEqual(before);
  });
});

describe("setBrowserTabUrl", () => {
  test("存在するbrowserタブのurlを更新し、onDirtyを呼ぶ", () => {
    const { factory } = createFakeSessionFactory();
    let dirtyCount = 0;
    const ws = createBoard(baseOpts({ createSession: factory, onDirty: () => dirtyCount++ }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const tabId = ws.newBrowserTab(tileId, "https://example.com") as string;
    dirtyCount = 0;

    const result = ws.setBrowserTabUrl(tabId, "https://example.com/next");

    expect(result).toBe(true);
    expect(ws.snapshot().tabs[tabId]).toEqual({
      kind: "browser",
      url: "https://example.com/next",
    });
    expect(dirtyCount).toBe(1);
  });

  test("存在しないtabIdはfalseを返し、onDirtyを呼ばない", () => {
    const { factory } = createFakeSessionFactory();
    let dirtyCount = 0;
    const ws = createBoard(baseOpts({ createSession: factory, onDirty: () => dirtyCount++ }));
    dirtyCount = 0;

    expect(ws.setBrowserTabUrl("not-found", "https://example.com")).toBe(false);
    expect(dirtyCount).toBe(0);
  });

  test("terminalタブのtabIdを渡してもfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;

    expect(ws.setBrowserTabUrl(tabId, "https://example.com")).toBe(false);
  });
});

describe("switchTab", () => {
  test("tabIdsに存在するタブへactiveTabIdが切り替わり、trueを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    const firstTabId = (ws.snapshot().layout as TileLeaf).tabIds[0];
    const result = ws.switchTab(tileId, firstTabId);
    expect(result).toBe(true);
    expect((ws.snapshot().layout as TileLeaf).activeTabId).toBe(firstTabId);
  });

  test("存在しないtabIdはfalseを返し、無視される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const before = ws.snapshot().layout as TileLeaf;
    const result = ws.switchTab(before.id, "not-a-tab");
    expect(result).toBe(false);
    expect((ws.snapshot().layout as TileLeaf).activeTabId).toBe(before.activeTabId);
  });
});

describe("moveTab", () => {
  test("タブを別タイルへ移動すると、移動先のactiveTabIdになりtrueを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    const movingTabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    const split = ws.splitTile(firstTileId, "vertical") as { tileId: string };

    const result = ws.moveTab(firstTileId, movingTabId, split.tileId);

    expect(result).toBe(true);
    const after = ws.snapshot().layout;
    expect(after.kind).toBe("leaf");
    expect((after as TileLeaf).id).toBe(split.tileId);
    expect((after as TileLeaf).tabIds).toContain(movingTabId);
    expect((after as TileLeaf).activeTabId).toBe(movingTabId);
  });

  test("移動元がタイル最後の1タブだった場合、tileごと畳まれ、そのtile名は破棄される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    const movingTabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    const split = ws.splitTile(firstTileId, "vertical") as { tileId: string };
    ws.setTileName(firstTileId, "元タイル");

    const result = ws.moveTab(firstTileId, movingTabId, split.tileId);

    expect(result).toBe(true);
    const after = ws.snapshot().layout;
    expect(after.kind).toBe("leaf");
    expect(ws.snapshot().tileNames[firstTileId]).toBeUndefined();
  });

  test("移動先タイルへフォーカスが移る", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(firstTileId);
    const [firstTabId] = (ws.snapshot().layout as TileLeaf).tabIds;
    const split = ws.splitTile(firstTileId, "vertical") as { tileId: string };
    // splitTile直後は新タイル側にフォーカスが移るため、一旦移動元へ戻してから検証する
    ws.focusTile(firstTileId);

    ws.moveTab(firstTileId, firstTabId, split.tileId);

    expect(ws.snapshot().focusedTileId).toBe(split.tileId);
  });

  test("存在しないtabIdはfalseを返し、木は変化しない", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    const split = ws.splitTile(firstTileId, "vertical") as { tileId: string };
    const before = ws.snapshot().layout;

    const result = ws.moveTab(firstTileId, "not-a-tab", split.tileId);

    expect(result).toBe(false);
    expect(ws.snapshot().layout).toEqual(before);
  });

  test("移動先が存在しないtileIdの場合はfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const leaf = ws.snapshot().layout as TileLeaf;

    const result = ws.moveTab(leaf.id, leaf.activeTabId, "not-found");

    expect(result).toBe(false);
  });

  test("移動元と移動先が同一の場合はfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const leaf = ws.snapshot().layout as TileLeaf;

    const result = ws.moveTab(leaf.id, leaf.activeTabId, leaf.id);

    expect(result).toBe(false);
  });
});

describe("closeTab", () => {
  test("複数タブのうち1つを閉じるとそのセッションだけdisposeされ、タイルは残る。戻り値はtrue", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
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
    const ws = createBoard(baseOpts({ createSession: factory }));
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

  test("Board最後の1枚のタイルの最後のタブは閉じられない（誤操作防止）。戻り値はfalse", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const leaf = ws.snapshot().layout as TileLeaf;
    const result = ws.closeTab(leaf.id, leaf.activeTabId);
    expect(result).toBe(false);
    expect(ws.snapshot().layout).toEqual(leaf);
  });
});

describe("findTileIdForTab / hasBrowserTab", () => {
  test("findTileIdForTabはterminalタブ・browserタブいずれの所属tileIdも返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const terminalTabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    const browserTabId = ws.newBrowserTab(tileId, "https://example.com") as string;

    expect(ws.findTileIdForTab(terminalTabId)).toBe(tileId);
    expect(ws.findTileIdForTab(browserTabId)).toBe(tileId);
  });

  test("findTileIdForTabは存在しないtabIdはnullを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    expect(ws.findTileIdForTab("not-found")).toBeNull();
  });

  test("hasBrowserTabはbrowserタブのみtrue、terminalタブ・不存在はfalse", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
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
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    expect(ws.getTabText(tabId)).toBe("");
  });

  test("存在しないtabIdはnullを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    expect(ws.getTabText("not-found")).toBeNull();
  });
});

describe("focusTile", () => {
  test("存在するtileIdへfocusedTileIdが切り替わり、trueを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.splitTile(firstTileId, "vertical");
    const result = ws.focusTile(firstTileId);
    expect(result).toBe(true);
    expect(ws.snapshot().focusedTileId).toBe(firstTileId);
  });

  test("存在しないtileIdはfalseを返し、focusedTileIdは変わらない", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const before = ws.snapshot().focusedTileId;
    const result = ws.focusTile("not-found");
    expect(result).toBe(false);
    expect(ws.snapshot().focusedTileId).toBe(before);
  });
});

describe("toggleZoomTile", () => {
  test("1回目でズームON、2回目でOFFに戻る。トグル後の状態を返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;

    expect(ws.toggleZoomTile(tileId)).toBe(true);
    expect(ws.snapshot().zoomedTileId).toBe(tileId);

    expect(ws.toggleZoomTile(tileId)).toBe(false);
    expect(ws.snapshot().zoomedTileId).toBeNull();
  });

  test("存在しないtileIdはnullを返し、zoomedTileIdは変わらない", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const result = ws.toggleZoomTile("not-found");
    expect(result).toBeNull();
    expect(ws.snapshot().zoomedTileId).toBeNull();
  });

  test("splitのidを渡すとnullを返す（leafのみズーム可能）", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.splitTile(firstTileId, "vertical");
    const splitId = ws.snapshot().layout.id;
    const result = ws.toggleZoomTile(splitId);
    expect(result).toBeNull();
    expect(ws.snapshot().zoomedTileId).toBeNull();
  });

  test("ズーム中のtileを分割すると自動でズーム解除される（新規tileが隠れたままにならないよう）", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.toggleZoomTile(tileId);
    expect(ws.snapshot().zoomedTileId).toBe(tileId);

    ws.splitTile(tileId, "vertical");
    expect(ws.snapshot().zoomedTileId).toBeNull();
  });

  test("ズーム中のtileを閉じると自動でズーム解除される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    const split = ws.splitTile(firstTileId, "vertical");
    const secondTileId = split?.tileId as string;
    const secondTabId = split?.tabId as string;
    ws.toggleZoomTile(secondTileId);
    expect(ws.snapshot().zoomedTileId).toBe(secondTileId);

    ws.closeTab(secondTileId, secondTabId);
    expect(ws.snapshot().zoomedTileId).toBeNull();
  });

  test("別tileへfocusTileすると自動でズーム解除される。同じtileへの再フォーカスは維持される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    const split = ws.splitTile(firstTileId, "vertical");
    const secondTileId = split?.tileId as string;
    ws.toggleZoomTile(firstTileId);

    ws.focusTile(firstTileId);
    expect(ws.snapshot().zoomedTileId).toBe(firstTileId);

    ws.focusTile(secondTileId);
    expect(ws.snapshot().zoomedTileId).toBeNull();
  });

  test("別tileへfocusDirectionすると自動でズーム解除される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.splitTile(firstTileId, "vertical"); // vertical=row split（左右に並ぶ）
    ws.focusTile(firstTileId);
    ws.toggleZoomTile(firstTileId);

    ws.focusDirection("right");
    expect(ws.snapshot().focusedTileId).not.toBe(firstTileId);
    expect(ws.snapshot().zoomedTileId).toBeNull();
  });
});

describe("タブ変数(setTabVar/getTabVar/listTabVars)", () => {
  test("set→getで同じ値が返る。上書きもできる", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;

    expect(ws.setTabVar(tabId, "status", "running")).toBe(true);
    expect(ws.getTabVar(tabId, "status")).toEqual({ found: true, value: "running" });

    expect(ws.setTabVar(tabId, "status", "done")).toBe(true);
    expect(ws.getTabVar(tabId, "status")).toEqual({ found: true, value: "done" });
  });

  test("未設定キーはfound:false, reason:not-set", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    expect(ws.getTabVar(tabId, "not-set-key")).toEqual({ found: false, reason: "not-set" });
  });

  test("listTabVarsは設定済みの全キーを返す。未設定なら空オブジェクト", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;

    expect(ws.listTabVars(tabId)).toEqual({});
    ws.setTabVar(tabId, "a", "1");
    ws.setTabVar(tabId, "b", "2");
    expect(ws.listTabVars(tabId)).toEqual({ a: "1", b: "2" });
  });

  test("存在しないtabIdはsetがfalse、getがtab-not-found、listがnull", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    expect(ws.setTabVar("not-found", "k", "v")).toBe(false);
    expect(ws.getTabVar("not-found", "k")).toEqual({ found: false, reason: "tab-not-found" });
    expect(ws.listTabVars("not-found")).toBeNull();
  });

  test("存在するtileIdをtabIdとして渡してもtab-not-found扱い（別ID空間）", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    expect(ws.setTabVar(tileId, "k", "v")).toBe(false);
    expect(ws.listTabVars(tileId)).toBeNull();
  });

  test("closeTabで閉じたタブの変数は消える", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const secondTabId = ws.newTab(tileId) as string;
    ws.setTabVar(secondTabId, "k", "v");

    ws.closeTab(tileId, secondTabId);

    expect(ws.getTabVar(secondTabId, "k")).toEqual({ found: false, reason: "tab-not-found" });
  });

  test("タイル自体が畳まれて閉じられても、消えたのはそのタブの変数のみ", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    const firstTabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    ws.setTabVar(firstTabId, "k", "keep");
    ws.splitTile(firstTileId, "vertical");
    const splitTree = ws.snapshot().layout;
    const secondLeaf = (splitTree as typeof splitTree & { kind: "split" }).second as TileLeaf;
    ws.setTabVar(secondLeaf.activeTabId, "k", "v");

    ws.closeTab(secondLeaf.id, secondLeaf.activeTabId);

    expect(ws.getTabVar(secondLeaf.activeTabId, "k")).toEqual({
      found: false,
      reason: "tab-not-found",
    });
    expect(ws.getTabVar(firstTabId, "k")).toEqual({ found: true, value: "keep" });
  });

  test("同一タイル内の他タブを閉じても、残るタブの変数は消えない", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const firstTabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    const secondTabId = ws.newTab(tileId) as string;
    ws.setTabVar(firstTabId, "k", "v");

    ws.closeTab(tileId, secondTabId);

    expect(ws.getTabVar(firstTabId, "k")).toEqual({ found: true, value: "v" });
  });

  test("同一タイル内の複数タブがそれぞれ独立したタブ変数を持てる（タブ単位化の主目的）", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const tabA = (ws.snapshot().layout as TileLeaf).activeTabId;
    const tabB = ws.newTab(tileId) as string;

    ws.setTabVar(tabA, "agent_status", "working");
    ws.setTabVar(tabB, "agent_status", "idle");

    expect(ws.getTabVar(tabA, "agent_status")).toEqual({ found: true, value: "working" });
    expect(ws.getTabVar(tabB, "agent_status")).toEqual({ found: true, value: "idle" });
  });

  test("setTabVarはonDirtyを呼ぶ（サイドバーへの即時反映のため）", () => {
    const { factory } = createFakeSessionFactory();
    let dirtyCount = 0;
    const ws = createBoard(baseOpts({ createSession: factory, onDirty: () => dirtyCount++ }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    dirtyCount = 0;

    ws.setTabVar(tabId, "agent_status", "working");

    expect(dirtyCount).toBe(1);
  });

  test("存在しないtabIdへのsetTabVarはonDirtyを呼ばない", () => {
    const { factory } = createFakeSessionFactory();
    let dirtyCount = 0;
    const ws = createBoard(baseOpts({ createSession: factory, onDirty: () => dirtyCount++ }));
    dirtyCount = 0;

    ws.setTabVar("not-found", "k", "v");

    expect(dirtyCount).toBe(0);
  });
});

// スクロールはPTY出力を経由しないため、input/pasteと違いonOutput経由のonDirtyが起きない。
// handleScroll系がonDirtyを呼び忘れると、内部の表示位置は変わるのにwebviewへ再描画が
// 届かず「操作しても画面が動かない」という不具合になる（実機検証で発覚した回帰）
describe("handleScroll/handleScrollToTop/handleScrollToBottom", () => {
  test("handleScrollはonDirtyを呼ぶ（再描画をスケジュールするため）", () => {
    const { factory } = createFakeSessionFactory();
    let dirtyCount = 0;
    const ws = createBoard(baseOpts({ createSession: factory, onDirty: () => dirtyCount++ }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    dirtyCount = 0;

    ws.handleScroll(tabId, -10);

    expect(dirtyCount).toBe(1);
  });

  test("handleScrollToTopはonDirtyを呼ぶ", () => {
    const { factory } = createFakeSessionFactory();
    let dirtyCount = 0;
    const ws = createBoard(baseOpts({ createSession: factory, onDirty: () => dirtyCount++ }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    dirtyCount = 0;

    ws.handleScrollToTop(tabId);

    expect(dirtyCount).toBe(1);
  });

  test("handleScrollToBottomはonDirtyを呼ぶ", () => {
    const { factory } = createFakeSessionFactory();
    let dirtyCount = 0;
    const ws = createBoard(baseOpts({ createSession: factory, onDirty: () => dirtyCount++ }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    dirtyCount = 0;

    ws.handleScrollToBottom(tabId);

    expect(dirtyCount).toBe(1);
  });

  test("存在しないtabIdへのhandleScrollはonDirtyを呼ばない", () => {
    const { factory } = createFakeSessionFactory();
    let dirtyCount = 0;
    const ws = createBoard(baseOpts({ createSession: factory, onDirty: () => dirtyCount++ }));
    dirtyCount = 0;

    ws.handleScroll("not-found", -10);
    ws.handleScrollToTop("not-found");
    ws.handleScrollToBottom("not-found");

    expect(dirtyCount).toBe(0);
  });
});

describe("タブ名・タイル名(setTabName/setTileName/listTabNames/listTileNames)", () => {
  test("set→listで同じ値が返る。上書きもできる", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;

    expect(ws.setTabName(tabId, "roadmap")).toBe(true);
    expect(ws.listTabNames()).toEqual({ [tabId]: "roadmap" });

    expect(ws.setTabName(tabId, "notes")).toBe(true);
    expect(ws.listTabNames()).toEqual({ [tabId]: "notes" });
  });

  test("空文字列（前後空白のみも含む）を渡すと名前が削除されデフォルトへ戻る", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.setTileName(tileId, "作業ペイン");

    expect(ws.setTileName(tileId, "  ")).toBe(true);

    expect(ws.listTileNames()).toEqual({});
  });

  test("未設定のタブ・タイルはlistTabNames/listTileNamesに含まれない", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    expect(ws.listTabNames()).toEqual({});
    expect(ws.listTileNames()).toEqual({});
  });

  test("存在しないtabId/tileIdへのsetはfalseを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    expect(ws.setTabName("not-found", "x")).toBe(false);
    expect(ws.setTileName("not-found", "x")).toBe(false);
  });

  test("closeTabで閉じたタブの名前は消える", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const secondTabId = ws.newTab(tileId) as string;
    ws.setTabName(secondTabId, "sub");

    ws.closeTab(tileId, secondTabId);

    expect(ws.listTabNames()).toEqual({});
  });

  test("タイル自体が畳まれて閉じられると、そのタイル名も消える", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const firstTileId = (ws.snapshot().layout as TileLeaf).id;
    ws.setTileName(firstTileId, "keep");
    ws.splitTile(firstTileId, "vertical");
    const splitTree = ws.snapshot().layout;
    const secondLeaf = (splitTree as typeof splitTree & { kind: "split" }).second as TileLeaf;
    ws.setTileName(secondLeaf.id, "gone");

    ws.closeTab(secondLeaf.id, secondLeaf.activeTabId);

    expect(ws.listTileNames()).toEqual({ [firstTileId]: "keep" });
  });

  test("setTabName/setTileNameはonDirtyを呼ぶ（サイドバーへの即時反映のため）", () => {
    const { factory } = createFakeSessionFactory();
    let dirtyCount = 0;
    const ws = createBoard(baseOpts({ createSession: factory, onDirty: () => dirtyCount++ }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    dirtyCount = 0;

    ws.setTabName(tabId, "roadmap");
    ws.setTileName(tileId, "作業ペイン");

    expect(dirtyCount).toBe(2);
  });
});

describe("シェルプロセス終了時の挙動(onExit経由)", () => {
  test("複数タブがあるタイルで1つのプロセスが終了しても、そのタブだけ消えタイルは残る", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    ws.newTab(tileId);
    const leaf = ws.snapshot().layout as TileLeaf;
    const [firstTabId] = leaf.tabIds;

    created[0]?.opts.onExit?.(0);

    const after = ws.snapshot().layout as TileLeaf;
    expect(after.tabIds).not.toContain(firstTabId);
    expect(after.tabIds.length).toBe(1);
  });

  test("Board最後の1枚・最後のタブのプロセスが終了するとonAllTabsClosedが呼ばれる", () => {
    const { created, factory } = createFakeSessionFactory();
    let allClosed = false;
    const ws = createBoard(
      baseOpts({ createSession: factory, onAllTabsClosed: () => (allClosed = true) }),
    );
    void ws;
    created[0]?.opts.onExit?.(0);
    expect(allClosed).toBe(true);
  });
});

describe("getPersistableTabs", () => {
  test("terminalタブはkind/shell/name/varsを含む。値が未設定のキーは省略される", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(
      baseOpts({ createSession: factory, getDefaultShell: () => "/bin/bash" }),
    );
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    ws.setTabName(tabId, "work");
    ws.setTabVar(tabId, "cwd", "/home/eetann");

    expect(ws.getPersistableTabs()).toEqual({
      [tabId]: {
        kind: "terminal",
        shell: "/bin/bash",
        name: "work",
        vars: { cwd: "/home/eetann" },
      },
    });
  });

  test("メタ情報が何も無いterminalタブはkindのみ", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;

    expect(ws.getPersistableTabs()).toEqual({ [tabId]: { kind: "terminal" } });
  });

  test("browserタブはkind/urlを含み、名前・変数があればそれも含む", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const tabId = ws.newBrowserTab(tileId, "https://example.com") as string;
    ws.setTabName(tabId, "docs");

    const persisted = ws.getPersistableTabs();
    expect(persisted[tabId]).toEqual({ kind: "browser", url: "https://example.com", name: "docs" });
  });
});

describe("adoptTab（popup.tsからの昇格編入。ADR 0006）", () => {
  test("フォーカス中タイルへタブを編入し、セッションを作り直さずtree/tabVars/shellへ反映する", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    const adopted = factory({ cols: 40, rows: 10 });
    const adoptedRecord = created[created.length - 1] as FakeSessionRecord;
    const countBeforeAdopt = created.length;

    const ok = ws.adoptTab("tab-adopted", adopted, {
      cols: 40,
      rows: 10,
      shell: "/bin/zsh",
      vars: { cwd: "/tmp/popup" },
    });

    expect(ok).toBe(true);
    expect(created.length).toBe(countBeforeAdopt); // 新規セッションは作られない（PTY再生成なし）
    const leaf = ws.snapshot().layout as TileLeaf;
    expect(leaf.id).toBe(tileId);
    expect(leaf.tabIds).toContain("tab-adopted");
    expect(leaf.activeTabId).toBe("tab-adopted");
    expect(ws.hasTab("tab-adopted")).toBe(true);
    expect(ws.getPersistableTabs()["tab-adopted"]).toEqual({
      kind: "terminal",
      shell: "/bin/zsh",
      vars: { cwd: "/tmp/popup" },
    });
    expect(adoptedRecord.disposed).toBe(false);
  });

  test("編入後のPTY終了はBoard側のタブclose処理として扱われ、編入前のコールバック（popup側）は呼ばれない", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const tileId = (ws.snapshot().layout as TileLeaf).id;
    // 最後の1枚だと閉じた時にタイルごと消えてしまうため、編入先とは別にもう1タブ用意しておく
    ws.newTab(tileId);

    let popupOnExitCalled = false;
    const adopted = factory({
      cols: 40,
      rows: 10,
      onExit: () => {
        popupOnExitCalled = true;
      },
    });
    const adoptedRecord = created[created.length - 1] as FakeSessionRecord;
    ws.adoptTab("tab-adopted", adopted, { cols: 40, rows: 10 });

    // setCallbacksによってBoard側のonExitへ配線し直されているはず
    adoptedRecord.callbacks.onExit?.(0);

    expect(popupOnExitCalled).toBe(false);
    expect(ws.hasTab("tab-adopted")).toBe(false);
    const leaf = ws.snapshot().layout as TileLeaf;
    expect(leaf.tabIds).not.toContain("tab-adopted");
  });

  test("編入後のOSC7 cwd通知はBoard側のtabVar 'cwd' へ反映される", () => {
    const { created, factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));
    const adopted = factory({ cols: 40, rows: 10 });
    const adoptedRecord = created[created.length - 1] as FakeSessionRecord;
    ws.adoptTab("tab-adopted", adopted, { cols: 40, rows: 10 });

    adoptedRecord.callbacks.onPwdChanged?.("/repo/after-promote");

    expect(ws.getTabVar("tab-adopted", "cwd")).toEqual({
      found: true,
      value: "/repo/after-promote",
    });
  });
});

describe("getFocusedTabSnapshot", () => {
  test("フォーカス中タイルのアクティブタブのcols/rows/cwdを返す", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory, initialCols: 80, initialRows: 24 }));
    const tabId = (ws.snapshot().layout as TileLeaf).activeTabId;
    ws.setTabVar(tabId, "cwd", "/home/eetann/work");

    expect(ws.getFocusedTabSnapshot()).toEqual({ cols: 80, rows: 24, cwd: "/home/eetann/work" });
  });

  test("cwd未報告の場合はcwd:undefined", () => {
    const { factory } = createFakeSessionFactory();
    const ws = createBoard(baseOpts({ createSession: factory }));

    expect(ws.getFocusedTabSnapshot()?.cwd).toBeUndefined();
  });
});
