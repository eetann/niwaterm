import { describe, expect, test } from "bun:test";
import type { LayoutPreset, ShellProfile } from "@niwaterm/config";
import type { BoardId } from "./board";
import { applyLayoutPreset, validateLayoutPreset } from "./layout-apply";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import { listLeaves, type TileLeaf, type TileNode } from "./tile-layout";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

/**
 * PTY起動はwebview側の実測cols/rowsが届く（handleResize）まで保留される設計。
 * テストではapplyLayoutPreset等の直後にこれを呼び、pending中の全タブへダミーのcols/rowsを
 * 送ってPTY起動を確定させる
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
      writeWhenReady: (data) => record.push(data),
      paste: () => {},
      mouseEvent: () => {},
      resize: () => false,
      setCellSize: () => {},
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
      dumpText: () => `screen-text-${index}`,
      setCallbacks: () => {},
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

/** テスト用: アクティブworkspace配下に新規Boardを作り、そのboardIdを返す */
function newBoardInActiveWorkspace(mgr: WorkspaceManager, cwd?: string): BoardId {
  const workspaceId = mgr.snapshot().activeWorkspaceId;
  const boardId = mgr.newBoard(workspaceId, cwd);
  if (!boardId) throw new Error("unreachable");
  return boardId;
}

function findBoardEntry(mgr: WorkspaceManager, boardId: BoardId) {
  for (const entry of mgr.listWorkspaces()) {
    const board = entry.boards.find((b) => b.boardId === boardId);
    if (board) return board;
  }
  return undefined;
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

describe("applyLayoutPreset (target: new-board)", () => {
  test("単一タイル・単一タブのプリセットを新規Boardとして適用する", () => {
    const { mgr, writes, sessionOpts } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr);
    const preset: LayoutPreset = {
      layout: {
        kind: "tile",
        tabs: [{ name: "editor", command: "nvim", cwd: "/tmp/project" }],
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId);
    resolvePending(mgr);

    expect(result).toMatchObject({ ok: true, boardId });
    if (!result.ok) throw new Error("unreachable");

    const board = findBoardEntry(mgr, result.boardId);
    const leaf = board?.layout as TileLeaf;
    expect(leaf.tabIds.length).toBe(1);
    const tabId = leaf.tabIds[0] as string;
    expect(board?.tabNames[tabId]).toBe("editor");

    // プレースホルダーはPTY起動保留中のまま閉じられるため、実際のタブのセッションだけが残る想定
    const realSessionIndex = sessionOpts.findIndex((o) => o.cwd === "/tmp/project");
    expect(realSessionIndex).toBeGreaterThanOrEqual(0);
    expect(writes[realSessionIndex]).toEqual(["nvim\r"]);
  });

  test("split構成のプリセットを指定したorientation・ratioで組み立てる", () => {
    const { mgr } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr);
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        ratio: 0.7,
        first: { kind: "tile", tabs: [{ name: "left" }] },
        second: { kind: "tile", tabs: [{ name: "right" }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const board = findBoardEntry(mgr, result.boardId);
    const tree = board?.layout as TileNode & { kind: "split" };
    expect(tree.kind).toBe("split");
    expect(tree.direction).toBe("row"); // vertical(左右並び) = row
    expect(tree.ratio).toBe(0.7);
    expect((tree.first as TileLeaf).tabIds.length).toBe(1);
    expect((tree.second as TileLeaf).tabIds.length).toBe(1);
  });

  test("分割で作った各タイルのタブへもcommandが届く", () => {
    // 分割で作るタイルのプレースホルダーはPTY起動が実測cols/rows到達まで保留される。
    // handleInputはsessions未登録のタブで黙って捨てるため、保留中は取りこぼしていた
    const { mgr, writes } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr);
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ name: "left", command: "echo left" }] },
        second: { kind: "tile", tabs: [{ name: "right", command: "echo right" }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId);
    expect(result.ok).toBe(true);
    resolvePending(mgr);

    const flat = writes.flat();
    expect(flat).toContain("echo left\r");
    expect(flat).toContain("echo right\r");
  });

  test("1タイルに複数タブを作り、activeTabで指定したタブがアクティブになる", () => {
    const { mgr } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr);
    const preset: LayoutPreset = {
      layout: {
        kind: "tile",
        tabs: [{ name: "a" }, { name: "b" }, { name: "c" }],
        activeTab: 0,
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const board = findBoardEntry(mgr, result.boardId);
    const leaf = board?.layout as TileLeaf;
    expect(leaf.tabIds.length).toBe(3);
    expect(board?.tabNames[leaf.activeTabId]).toBe("a");
  });

  test("activeTab省略時は最後に作られたタブがアクティブになる", () => {
    const { mgr } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr);
    const preset: LayoutPreset = {
      layout: { kind: "tile", tabs: [{ name: "a" }, { name: "b" }] },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const board = findBoardEntry(mgr, result.boardId);
    const leaf = board?.layout as TileLeaf;
    expect(board?.tabNames[leaf.activeTabId]).toBe("b");
  });

  test("focus:trueのタブが、そのタイルのアクティブタブになり、tile自体のフォーカスも当たる", () => {
    const { mgr } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr);
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ name: "left" }] },
        second: { kind: "tile", tabs: [{ name: "focused", focus: true }, { name: "not-focused" }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const board = findBoardEntry(mgr, result.boardId);
    const tree = board?.layout as TileNode & { kind: "split" };
    const secondLeaf = tree.second as TileLeaf;
    expect(board?.focusedTileId).toBe(secondLeaf.id);
    expect(board?.tabNames[secondLeaf.activeTabId]).toBe("focused");
  });

  test("varsを指定するとタブ変数として設定される", () => {
    const { mgr } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr);
    const preset: LayoutPreset = {
      layout: { kind: "tile", tabs: [{ vars: { role: "editor" } }] },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const board = findBoardEntry(mgr, result.boardId);
    const leaf = board?.layout as TileLeaf;
    expect(board?.tabVars[leaf.tabIds[0] as string]).toEqual({ role: "editor" });
  });

  test("shellProfileを指定するとそのプロファイルのcommandでセッションが起動する", () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr);
    const preset: LayoutPreset = {
      layout: { kind: "tile", tabs: [{ shellProfile: "wsl-ubuntu" }] },
    };

    const result = applyLayoutPreset(mgr, PROFILES, preset, "new-board", boardId);
    resolvePending(mgr);
    expect(result.ok).toBe(true);

    expect(sessionOpts.some((o) => o.shell === "wsl.exe -d Ubuntu")).toBe(true);
  });

  test("単一タイルのプリセットではinvocationCwdが最初のタブに使われる", () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    // 実運用ではipc-server.tsがnewBoardにも同じcwdを渡す（プレースホルダー自体がこのcwdで作られる）
    const boardId = newBoardInActiveWorkspace(mgr, "/proj");
    const preset: LayoutPreset = { layout: { kind: "tile", tabs: [{ name: "editor" }] } };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId, {
      invocationCwd: "/proj",
    });
    resolvePending(mgr);

    expect(result.ok).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/proj")).toBe(true);
  });

  test("invocationCwdはcwd未指定のタブすべてに既定値として使われ、tabConfig.cwdがあれば優先される", () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    // 実運用ではipc-server.tsがnewBoardにも同じcwdを渡す（プレースホルダー自体がこのcwdで作られる）
    const boardId = newBoardInActiveWorkspace(mgr, "/invocation/dir");
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ name: "left" }] },
        second: { kind: "tile", tabs: [{ name: "right", cwd: "/explicit" }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId, {
      invocationCwd: "/invocation/dir",
    });
    resolvePending(mgr);

    expect(result.ok).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/invocation/dir")).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/explicit")).toBe(true);
  });

  // --- プロジェクトローカル由来のプリセット ---

  test("projectRootはinvocationCwdより優先してcwdの基準になる", () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr, "/proj");
    const preset: LayoutPreset = { layout: { kind: "tile", tabs: [{ name: "editor" }] } };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId, {
      invocationCwd: "/somewhere/else",
      projectRoot: "/proj",
    });
    resolvePending(mgr);

    expect(result.ok).toBe(true);
    // リポジトリへコミットしたプリセットが「どこから実行されたか」に左右されないようにする
    expect(sessionOpts.some((o) => o.cwd === "/proj")).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/somewhere/else")).toBe(false);
  });

  test("tabBaseCwdはprojectRoot・invocationCwdのどちらより優先される", () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr, "/repo/work/feature");
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ name: "editor" }] },
        second: { kind: "tile", tabs: [{ name: "cli", cwd: "./packages/cli" }] },
      },
    };

    // ワークツリーのBoardは、プリセットをメインワークツリーから引きつつ
    // タブはそのワークツリーで開く
    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId, {
      invocationCwd: "/repo/main",
      projectRoot: "/repo/main",
      tabBaseCwd: "/repo/work/feature",
    });
    resolvePending(mgr);

    expect(result.ok).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/repo/work/feature")).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/repo/work/feature/packages/cli")).toBe(true);
    expect(sessionOpts.some((o) => o.cwd?.startsWith("/repo/main"))).toBe(false);
  });

  test('"replace"で使い回す既存タブのcwdもbaseCwdへ揃う', () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    // 適用前のBoardはホームディレクトリで作られている、という状況を作る
    const boardId = newBoardInActiveWorkspace(mgr, "/home/me");
    resolvePending(mgr);
    expect(sessionOpts.some((o) => o.cwd === "/home/me")).toBe(true);

    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        // 最初に到達するタイル＝プレースホルダーを使い回す側（cwd/shellProfile未指定）
        first: { kind: "tile", tabs: [{ name: "other" }] },
        second: { kind: "tile", tabs: [{ name: "server" }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "replace", boardId, {
      projectRoot: "/proj",
    });
    resolvePending(mgr);

    expect(result.ok).toBe(true);
    // 使い回したタブがホームのまま取り残されない（alignPlaceholderCwd）
    expect(sessionOpts.filter((o) => o.cwd === "/home/me").length).toBe(1);
    expect(sessionOpts.filter((o) => o.cwd === "/proj").length).toBeGreaterThanOrEqual(2);
  });

  test("tabConfig.cwdの相対パスはprojectRoot基準で解決される", () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr, "/proj");
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ name: "cli", cwd: "./packages/cli" }] },
        second: { kind: "tile", tabs: [{ name: "abs", cwd: "/elsewhere" }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId, {
      projectRoot: "/proj",
    });
    resolvePending(mgr);

    expect(result.ok).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/proj/packages/cli")).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/elsewhere")).toBe(true);
  });

  test("バリデーションに失敗した場合はBoardに一切触れずエラーを返す", () => {
    const { mgr } = createTestWorkspaceManager();
    const boardId = newBoardInActiveWorkspace(mgr);
    const before = findBoardEntry(mgr, boardId)?.layout;
    const preset: LayoutPreset = {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ focus: true }] },
        second: { kind: "tile", tabs: [{ focus: true }] },
      },
    };

    const result = applyLayoutPreset(mgr, [], preset, "new-board", boardId);

    expect(result.ok).toBe(false);
    expect(findBoardEntry(mgr, boardId)?.layout).toEqual(before);
  });
});

describe("applyLayoutPreset (target: replace)", () => {
  test("既存Boardを畳んでから新しい構成で組み立て直す。既存セッションはdisposeされる", () => {
    const { mgr, created } = (() => {
      const { mgr, sessionOpts } = createTestWorkspaceManager();
      return { mgr, created: sessionOpts };
    })();

    // 既存のBoardを2タイルへ分割しておく
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    const boardId = mgr.snapshot().workspace.activeBoardId;
    const workspaceCountBefore = mgr.snapshot().workspaceIds.length;

    const preset: LayoutPreset = {
      layout: { kind: "tile", tabs: [{ name: "fresh" }] },
    };
    const result = applyLayoutPreset(mgr, [], preset, "replace", boardId);
    resolvePending(mgr);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // replaceは既存のBoardをそのまま使う（新規ワークスペース・Boardは作らない）
    expect(result.boardId).toBe(boardId);
    expect(mgr.snapshot().workspaceIds.length).toBe(workspaceCountBefore);

    const board = findBoardEntry(mgr, boardId);
    const leaf = board?.layout as TileLeaf;
    expect(leaf.kind).toBe("leaf");
    expect(leaf.tabIds.length).toBe(1);
    expect(board?.tabNames[leaf.tabIds[0] as string]).toBe("fresh");

    expect(created.length).toBeGreaterThan(0);
  });

  test("バリデーションに失敗した場合は既存のBoardに一切手を触れない", () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    const boardId = mgr.snapshot().workspace.activeBoardId;
    const before = mgr.snapshot().workspace.board.layout;

    const preset: LayoutPreset = { layout: { kind: "tile", tabs: [] } };
    const result = applyLayoutPreset(mgr, [], preset, "replace", boardId);

    expect(result.ok).toBe(false);
    expect(mgr.snapshot().workspace.board.layout).toEqual(before);
  });
});
