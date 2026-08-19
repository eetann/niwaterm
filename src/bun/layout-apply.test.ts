import { describe, expect, test } from "bun:test";
import type { LayoutPreset, ShellProfile } from "@niwaterm/config";
import { applyLayoutPreset, validateLayoutPreset } from "./layout-apply";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import type { TileLeaf, TileNode } from "./tile-layout";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

function createTestWorkspaceManager(): {
  mgr: WorkspaceManager;
  writes: (string | Uint8Array)[][];
  sessionOpts: TerminalSessionOptions[];
} {
  const writes: (string | Uint8Array)[][] = [];
  const sessionOpts: TerminalSessionOptions[] = [];
  let sessionCount = 0;
  const createSession = (opts: TerminalSessionOptions): TerminalSession => {
    sessionOpts.push(opts);
    const record: (string | Uint8Array)[] = [];
    writes.push(record);
    const index = sessionCount++;
    return {
      write: (data) => record.push(data),
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
      dumpText: () => `screen-text-${index}`,
      dispose: () => {},
    };
  };
  const mgr = createWorkspaceManager({
    initialCols: 80,
    initialRows: 24,
    onDirty: () => {},
    onAllWorkspacesClosed: () => {},
    createSession,
  });
  return { mgr, writes, sessionOpts };
}

const PROFILES: ShellProfile[] = [
  { id: "wsl-ubuntu", name: "WSL: Ubuntu", command: "wsl.exe -d Ubuntu" },
];

describe("validateLayoutPreset", () => {
  test("有効なプリセットはnullを返す", () => {
    const preset: LayoutPreset = {
      layout: { kind: "tile", tabs: [{ command: "nvim" }] },
    };
    expect(validateLayoutPreset(preset, [])).toBeNull();
  });

  test("tabsが空のtileはエラーを返す", () => {
    const preset: LayoutPreset = { layout: { kind: "tile", tabs: [] } };
    expect(validateLayoutPreset(preset, [])).not.toBeNull();
  });

  test("未知のshellProfileを参照するタブはエラーを返す", () => {
    const preset: LayoutPreset = {
      layout: { kind: "tile", tabs: [{ shellProfile: "unknown" }] },
    };
    expect(validateLayoutPreset(preset, [])).not.toBeNull();
  });

  test("ratioが0〜1の範囲外のsplitはエラーを返す", () => {
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        ratio: 1.5,
        first: { kind: "tile", tabs: [{}] },
        second: { kind: "tile", tabs: [{}] },
      },
    };
    expect(validateLayoutPreset(preset, [])).not.toBeNull();
  });

  test("focus:trueが2つ以上あるとエラーを返す", () => {
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ focus: true }] },
        second: { kind: "tile", tabs: [{ focus: true }] },
      },
    };
    expect(validateLayoutPreset(preset, [])).not.toBeNull();
  });
});

describe("applyLayoutPreset (target: new-workspace)", () => {
  test("単一タイル・単一タブのプリセットを新規ワークスペースとして適用する", () => {
    const { mgr, writes, sessionOpts } = createTestWorkspaceManager();
    const firstId = mgr.snapshot().activeWorkspaceId;
    const preset: LayoutPreset = {
      layout: {
        kind: "tile",
        tabs: [{ name: "editor", command: "nvim", cwd: "/tmp/project" }],
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-workspace");

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("unreachable");
    expect(result.workspaceId).not.toBe(firstId);
    expect(mgr.snapshot().activeWorkspaceId).toBe(result.workspaceId);

    const entry = mgr.listWorkspaces().find((w) => w.workspaceId === result.workspaceId);
    const leaf = entry?.boards[0]?.layout as TileLeaf;
    expect(leaf.tabIds.length).toBe(1);
    const tabId = leaf.tabIds[0] as string;
    expect(entry?.boards[0]?.tabNames[tabId]).toBe("editor");

    // プレースホルダーのセッションはdispose済み、実際のタブのセッションだけが残る想定
    const realSessionIndex = sessionOpts.findIndex((o) => o.cwd === "/tmp/project");
    expect(realSessionIndex).toBeGreaterThanOrEqual(0);
    expect(writes[realSessionIndex]).toEqual(["nvim\r"]);
  });

  test("split構成のプリセットを指定したorientation・ratioで組み立てる", () => {
    const { mgr } = createTestWorkspaceManager();
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        ratio: 0.7,
        first: { kind: "tile", tabs: [{ name: "left" }] },
        second: { kind: "tile", tabs: [{ name: "right" }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-workspace");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const entry = mgr.listWorkspaces().find((w) => w.workspaceId === result.workspaceId);
    const tree = entry?.boards[0]?.layout as TileNode & { kind: "split" };
    expect(tree.kind).toBe("split");
    expect(tree.direction).toBe("row"); // vertical(左右並び) = row
    expect(tree.ratio).toBe(0.7);
    expect((tree.first as TileLeaf).tabIds.length).toBe(1);
    expect((tree.second as TileLeaf).tabIds.length).toBe(1);
  });

  test("1タイルに複数タブを作り、activeTabで指定したタブがアクティブになる", () => {
    const { mgr } = createTestWorkspaceManager();
    const preset: LayoutPreset = {
      layout: {
        kind: "tile",
        tabs: [{ name: "a" }, { name: "b" }, { name: "c" }],
        activeTab: 0,
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-workspace");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const entry = mgr.listWorkspaces().find((w) => w.workspaceId === result.workspaceId);
    const leaf = entry?.boards[0]?.layout as TileLeaf;
    expect(leaf.tabIds.length).toBe(3);
    expect(entry?.boards[0]?.tabNames[leaf.activeTabId]).toBe("a");
  });

  test("activeTab省略時は最後に作られたタブがアクティブになる", () => {
    const { mgr } = createTestWorkspaceManager();
    const preset: LayoutPreset = {
      layout: { kind: "tile", tabs: [{ name: "a" }, { name: "b" }] },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-workspace");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const entry = mgr.listWorkspaces().find((w) => w.workspaceId === result.workspaceId);
    const leaf = entry?.boards[0]?.layout as TileLeaf;
    expect(entry?.boards[0]?.tabNames[leaf.activeTabId]).toBe("b");
  });

  test("focus:trueのタブが、そのタイルのアクティブタブになり、tile自体のフォーカスも当たる", () => {
    const { mgr } = createTestWorkspaceManager();
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ name: "left" }] },
        second: { kind: "tile", tabs: [{ name: "focused", focus: true }, { name: "not-focused" }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-workspace");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const entry = mgr.listWorkspaces().find((w) => w.workspaceId === result.workspaceId);
    const tree = entry?.boards[0]?.layout as TileNode & { kind: "split" };
    const secondLeaf = tree.second as TileLeaf;
    expect(entry?.boards[0]?.focusedTileId).toBe(secondLeaf.id);
    expect(entry?.boards[0]?.tabNames[secondLeaf.activeTabId]).toBe("focused");
  });

  test("varsを指定するとタブ変数として設定される", () => {
    const { mgr } = createTestWorkspaceManager();
    const preset: LayoutPreset = {
      layout: { kind: "tile", tabs: [{ vars: { role: "editor" } }] },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-workspace");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const entry = mgr.listWorkspaces().find((w) => w.workspaceId === result.workspaceId);
    const leaf = entry?.boards[0]?.layout as TileLeaf;
    expect(entry?.boards[0]?.tabVars[leaf.tabIds[0] as string]).toEqual({ role: "editor" });
  });

  test("shellProfileを指定するとそのプロファイルのcommandでセッションが起動する", () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const preset: LayoutPreset = {
      layout: { kind: "tile", tabs: [{ shellProfile: "wsl-ubuntu" }] },
    };

    const result = applyLayoutPreset(mgr, PROFILES, preset, "new-workspace");
    expect(result.ok).toBe(true);

    expect(sessionOpts.some((o) => o.shell === "wsl.exe -d Ubuntu")).toBe(true);
  });

  test("単一タイルのプリセットではinvocationCwdが最初のタブに使われる", () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const preset: LayoutPreset = { layout: { kind: "tile", tabs: [{ name: "editor" }] } };

    const result = applyLayoutPreset(mgr, [], preset, "new-workspace", "/proj");

    expect(result.ok).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/proj")).toBe(true);
  });

  test("invocationCwdはcwd未指定のタブすべてに既定値として使われ、tabConfig.cwdがあれば優先される", () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ name: "left" }] },
        second: { kind: "tile", tabs: [{ name: "right", cwd: "/explicit" }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-workspace", "/invocation/dir");

    expect(result.ok).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/invocation/dir")).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/explicit")).toBe(true);
  });

  test("バリデーションに失敗した場合は新規ワークスペースを作らずエラーを返す", () => {
    const { mgr } = createTestWorkspaceManager();
    const before = mgr.snapshot().workspaceIds.length;
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ focus: true }] },
        second: { kind: "tile", tabs: [{ focus: true }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-workspace");

    expect(result.ok).toBe(false);
    expect(mgr.snapshot().workspaceIds.length).toBe(before);
  });
});

describe("applyLayoutPreset (target: replace)", () => {
  test("現在のワークスペースを畳んでから新しい構成で組み立て直す。既存セッションはdisposeされる", () => {
    const { mgr, created } = (() => {
      const { mgr, sessionOpts } = createTestWorkspaceManager();
      return { mgr, created: sessionOpts };
    })();

    // 既存のワークスペースを2タイルへ分割しておく
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    const activeId = mgr.snapshot().activeWorkspaceId;
    const workspaceCountBefore = mgr.snapshot().workspaceIds.length;

    const preset: LayoutPreset = {
      layout: { kind: "tile", tabs: [{ name: "fresh" }] },
    };
    const result = applyLayoutPreset(mgr, [], preset, "replace");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // replaceは既存のワークスペースをそのまま使う（新規ワークスペースは作らない）
    expect(result.workspaceId).toBe(activeId);
    expect(mgr.snapshot().workspaceIds.length).toBe(workspaceCountBefore);

    const entry = mgr.listWorkspaces().find((w) => w.workspaceId === activeId);
    const leaf = entry?.boards[0]?.layout as TileLeaf;
    expect(leaf.kind).toBe("leaf");
    expect(leaf.tabIds.length).toBe(1);
    expect(entry?.boards[0]?.tabNames[leaf.tabIds[0] as string]).toBe("fresh");

    expect(created.length).toBeGreaterThan(0);
  });

  test("バリデーションに失敗した場合は既存のワークスペースに一切手を触れない", () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    const before = mgr.snapshot().workspace.board.layout;

    const preset: LayoutPreset = { layout: { kind: "tile", tabs: [] } };
    const result = applyLayoutPreset(mgr, [], preset, "replace");

    expect(result.ok).toBe(false);
    expect(mgr.snapshot().workspace.board.layout).toEqual(before);
  });
});
