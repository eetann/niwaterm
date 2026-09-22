import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LayoutsConfig } from "@niwaterm/config";
import type { BrowserBridge } from "./browser-bridge";
import type { ScreenshotResult } from "./browser-screenshot";
import { createIpcServer, type IpcServer } from "./ipc-server";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import { listLeaves, type TileLeaf, type TileSplit } from "./tile-layout";
import { createWindowManager } from "./window-manager";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

/**
 * PTY起動はwebview側の実測cols/rowsが届く（handleResize）まで保留される設計。
 * テストではcreateTestWorkspaceManager/split-tile/new-tab等の直後にこれを呼び、pending中の
 * 全タブへダミーのcols/rowsを送ってPTY起動を確定させる
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

function createFakeBrowserBridge(overrides: Partial<BrowserBridge> = {}): BrowserBridge {
  return {
    navigate: overrides.navigate ?? (async () => ({ ok: true })),
    getText: overrides.getText ?? (async () => ({ ok: true, text: "fake-text" })),
    getHtml: overrides.getHtml ?? (async () => ({ ok: true, html: "<html></html>" })),
    getUrl: overrides.getUrl ?? (async () => ({ ok: true, url: "https://example.com/" })),
  };
}

function createFakeCaptureScreenshot(
  impl?: (url: string) => Promise<ScreenshotResult>,
): (url: string) => Promise<ScreenshotResult> {
  return impl ?? (async () => ({ ok: true, data: new Blob(["fake-png-bytes"]) }));
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
  // 初期タブのPTY起動はwebview側の実測cols/rowsが届くまで保留される。
  // このテストダブルでは即座に確定させ、以降のテストがsessionOpts/writesを同期的に検証できるようにする
  resolvePending(mgr);
  return { mgr, writes, sessionOpts };
}

describe("createIpcServer", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("/pingがok:true・pidを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);
    const res = await fetch("http://localhost/ping", { unix: socketPath });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pid: process.pid });
  });

  test("close()後はソケットファイルが消える", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);
    expect(existsSync(socketPath)).toBe(true);
    server.close();
    expect(existsSync(socketPath)).toBe(false);
  });

  test("stale（プロセスが生きていない）ソケットファイルが残っていても起動できる", async () => {
    await writeFile(socketPath, "");
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);
    const res = await fetch("http://localhost/ping", { unix: socketPath });
    expect(res.status).toBe(200);
  });

  test("既に別プロセスが同じソケットで生きている場合は例外を投げる", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);
    await expect(createIpcServer(socketPath, mgr)).rejects.toThrow();
  });
});

describe("GET /list", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("workspace/tile/tabの構造をそのまま返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/list", { unix: socketPath });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspaces: unknown[] };
    expect(body.workspaces.length).toBe(1);
    expect(body.workspaces[0]).toMatchObject({
      workspaceId: mgr.snapshot().activeWorkspaceId,
      active: true,
      boards: [expect.objectContaining({ layout: mgr.snapshot().workspace.board.layout })],
    });
  });
});

describe("GET /resolve-target", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("tabIdを渡すと、そのタブの所属ワークスペース・Board・タイルを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.listWorkspaces()[0]?.workspaceId as string;
    const boardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    // 分割してフォーカスを移し、「フォーカス中タイル」と「呼び出し元タブのタイル」をずらす
    mgr.splitTile(firstTileId, "vertical");
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch(`http://localhost/resolve-target?tabId=${firstTabId}`, {
      unix: socketPath,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      workspaceId,
      boardId,
      tileId: firstTileId,
      tabId: firstTabId,
    });
    expect(mgr.getFocusedTileId()).not.toBe(firstTileId);
  });

  test("tabId未指定はアクティブなワークスペースのフォーカス中タイル・アクティブタブを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.listWorkspaces()[0]?.workspaceId as string;
    const boardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const split = mgr.splitTile(firstTileId, "vertical");
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/resolve-target", { unix: socketPath });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      workspaceId,
      boardId,
      tileId: split?.tileId,
      tabId: split?.tabId,
    });
  });

  test("存在しないtabIdは404にせずフォーカス中タイル・アクティブタブへフォールバックする", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/resolve-target?tabId=not-found", {
      unix: socketPath,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tileId, tabId });
  });

  test("ポップアップのタブはtabIdをそのまま返し、タイルはフォーカス中タイルへ落ちる", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const popupTabId = mgr.openPopup() as string;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch(`http://localhost/resolve-target?tabId=${popupTabId}`, {
      unix: socketPath,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tileId, tabId: popupTabId });
  });

  test("非アクティブなワークスペースのtabIdでも、そのタブ側のワークスペースを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstWorkspaceId = mgr.listWorkspaces()[0]?.workspaceId as string;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const secondWorkspaceId = mgr.newWorkspace();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch(`http://localhost/resolve-target?tabId=${firstTabId}`, {
      unix: socketPath,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, workspaceId: firstWorkspaceId });
    expect(mgr.getActiveWorkspaceId()).toBe(secondWorkspaceId);
  });
});

describe("POST /send-keys", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("literalと特殊キー名混在をバイト列に変換してPTYへ書き込む", async () => {
    const { mgr, writes } = createTestWorkspaceManager();
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/send-keys", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId, keys: ["ls -la", "Enter"] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(writes[0]).toEqual(["ls -la\r"]);
  });

  test("存在しないtabIdは404を返しhandleInputは呼ばれない", async () => {
    const { mgr, writes } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/send-keys", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: "not-found", keys: ["Enter"] }),
    });

    expect(res.status).toBe(404);
    expect((await res.json()) as { ok: boolean }).toMatchObject({ ok: false });
    expect(writes[0]).toEqual([]);
  });

  test("不正なボディ（keysが空配列/未指定）は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/send-keys", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId, keys: [] }),
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /capture-tab", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("対象タブの画面内容をプレーンテキストで返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch(`http://localhost/capture-tab?tabId=${tabId}`, { unix: socketPath });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, text: "screen-text-0" });
  });

  test("存在しないtabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/capture-tab?tabId=not-found", { unix: socketPath });

    expect(res.status).toBe(404);
  });

  test("tabId未指定は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/capture-tab", { unix: socketPath });

    expect(res.status).toBe(400);
  });
});

describe("POST /split-tile", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("対象タイルを分割し、新規tileId/tabIdを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/split-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, orientation: "vertical" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tileId: string; tabId: string };
    expect(body.ok).toBe(true);
    expect(mgr.snapshot().workspace.board.layout.kind).toBe("split");
    expect(mgr.hasTab(body.tabId)).toBe(true);
  });

  test("存在しないtileIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/split-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: "not-found", orientation: "vertical" }),
    });

    expect(res.status).toBe(404);
  });

  test("不正なorientationは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/split-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, orientation: "diagonal" }),
    });

    expect(res.status).toBe(400);
  });

  test("cwdを指定すると新規タブのセッションへ渡る", async () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/split-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, orientation: "vertical", cwd: "/tmp/project" }),
    });
    resolvePending(mgr);

    expect(res.status).toBe(200);
    expect(sessionOpts[1]?.cwd).toBe("/tmp/project");
  });

  test("空文字列のcwdは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/split-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, orientation: "vertical", cwd: "" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /new-tab", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("対象タイルに新規タブを作成し、tabIdを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tabId: string };
    expect(body.ok).toBe(true);
    expect((mgr.snapshot().workspace.board.layout as TileLeaf).tabIds).toContain(body.tabId);
  });

  test("存在しないtileIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("urlを指定するとブラウザタブを作成する。hasTabはfalseのまま", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, url: "https://example.com" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tabId: string };
    expect(body.ok).toBe(true);
    expect(mgr.snapshot().workspace.board.tabs[body.tabId]).toEqual({
      kind: "browser",
      url: "https://example.com",
    });
    expect(mgr.hasTab(body.tabId)).toBe(false);
  });

  test("空文字列のurlは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, url: "" }),
    });

    expect(res.status).toBe(400);
  });

  test("customView:trueを指定すると設定済みのcustomViewを開くブラウザタブを作成する", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr, () => [
      { id: "notes", name: "Notes", url: "file:///tmp/notes.html", handlerNames: [] },
    ]);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, customView: true }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tabId: string };
    expect(body.ok).toBe(true);
    expect(mgr.snapshot().workspace.board.tabs[body.tabId]).toEqual({
      kind: "browser",
      url: "file:///tmp/notes.html",
    });
  });

  test("customViewが未設定の状態でcustomView:trueを指定すると400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, customView: true }),
    });

    expect(res.status).toBe(400);
  });

  test("customViewIdを指定するとそのidのcustomViewを開く", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr, () => [
      { id: "notes", name: "Notes", url: "file:///tmp/notes.html", handlerNames: [] },
      { id: "worktrees", name: "Worktrees", url: "file:///tmp/worktrees.html", handlerNames: [] },
    ]);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, customView: true, customViewId: "worktrees" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tabId: string };
    expect(mgr.snapshot().workspace.board.tabs[body.tabId]).toEqual({
      kind: "browser",
      url: "file:///tmp/worktrees.html",
    });
  });

  test("存在しないcustomViewIdを指定すると400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr, () => [
      { id: "notes", name: "Notes", url: "file:///tmp/notes.html", handlerNames: [] },
    ]);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, customView: true, customViewId: "missing" }),
    });

    expect(res.status).toBe(400);
  });

  test("customView無しでcustomViewIdだけ指定すると400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr, () => [
      { id: "notes", name: "Notes", url: "file:///tmp/notes.html", handlerNames: [] },
    ]);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, customViewId: "notes" }),
    });

    expect(res.status).toBe(400);
  });

  test("urlとcustomViewを同時に指定すると400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr, () => [
      { id: "notes", name: "Notes", url: "file:///tmp/notes.html", handlerNames: [] },
    ]);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, url: "https://example.com", customView: true }),
    });

    expect(res.status).toBe(400);
  });

  test("shellProfileIdを指定すると解決されたcommandでターミナルタブを作成する", async () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      undefined,
      undefined,
      () => [{ id: "wsl-ubuntu", name: "WSL: Ubuntu", command: "wsl.exe -d Ubuntu" }],
    );

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, shellProfileId: "wsl-ubuntu" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tabId: string };
    expect(body.ok).toBe(true);
    expect(mgr.hasTab(body.tabId)).toBe(true);
    expect(sessionOpts[1]?.shell).toBe("wsl.exe -d Ubuntu");
  });

  test("未知のshellProfileIdを指定すると400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, shellProfileId: "unknown" }),
    });

    expect(res.status).toBe(400);
  });

  test("urlとshellProfileIdを同時に指定すると400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, url: "https://example.com", shellProfileId: "wsl-ubuntu" }),
    });

    expect(res.status).toBe(400);
  });

  test("cwdを指定するとそのタブのセッションへ渡る", async () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, cwd: "/tmp/project" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tabId: string };
    expect(body.ok).toBe(true);
    expect(sessionOpts[1]?.cwd).toBe("/tmp/project");
  });

  test("cwdとshellProfileIdは併用でき、両方がセッションへ渡る", async () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      undefined,
      undefined,
      () => [{ id: "wsl-ubuntu", name: "WSL: Ubuntu", command: "wsl.exe -d Ubuntu" }],
    );

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, shellProfileId: "wsl-ubuntu", cwd: "/tmp/project" }),
    });

    expect(res.status).toBe(200);
    expect(sessionOpts[1]?.shell).toBe("wsl.exe -d Ubuntu");
    expect(sessionOpts[1]?.cwd).toBe("/tmp/project");
  });

  test("空文字列のcwdは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, cwd: "" }),
    });

    expect(res.status).toBe(400);
  });

  test("cwdとurlを同時に指定すると400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, url: "https://example.com", cwd: "/tmp/project" }),
    });

    expect(res.status).toBe(400);
  });

  test("cwdとcustomViewを同時に指定すると400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr, () => [
      { id: "notes", name: "Notes", url: "file:///tmp/notes.html", handlerNames: [] },
    ]);

    const res = await fetch("http://localhost/new-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, customView: true, cwd: "/tmp/project" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /shell-profiles", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("getShellProfiles未指定時は空配列を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/shell-profiles", { unix: socketPath });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; profiles: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.profiles).toEqual([]);
  });

  test("getShellProfilesが返すプロファイル一覧を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const profiles = [{ id: "powershell", name: "PowerShell", command: "powershell.exe -NoLogo" }];
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      undefined,
      undefined,
      () => profiles,
    );

    const res = await fetch("http://localhost/shell-profiles", { unix: socketPath });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; profiles: unknown[] };
    expect(body.profiles).toEqual(profiles);
  });
});

describe("GET /keybindings", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("getKeybindingsが返す設定をprefix・エントリ一覧へ均して返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({
        prefix: "ctrl+b",
        bindings: {
          d: "split-vertical",
          r: { target: { kind: "custom", id: "handler-0" }, description: "設定をリロードする" },
        },
        repeatTimeoutMs: 500,
      }),
    );

    const res = await fetch("http://localhost/keybindings", { unix: socketPath });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      prefix: "ctrl+b",
      repeatTimeoutMs: 500,
      entries: [
        { key: "d", action: "split-vertical", repeat: false, noPrefix: false },
        {
          key: "r",
          action: "function",
          description: "設定をリロードする",
          repeat: false,
          noPrefix: false,
        },
      ],
    });
  });

  test("getKeybindings未指定時はprefix:null・空のエントリ一覧を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/keybindings", { unix: socketPath });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      prefix: null,
      repeatTimeoutMs: 500,
      entries: [],
    });
  });
});

describe("POST /switch-tab", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("対象タイル内でアクティブタブを切り替える", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newTab(tileId);
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/switch-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, tabId: firstTabId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId).toBe(firstTabId);
  });

  test("存在しないtileId/tabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/switch-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: "not-found", tabId }),
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /cycle-tab", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("prevで1つ前のタブへ切り替える", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newTab(tileId);
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/cycle-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, direction: "prev" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId).toBe(firstTabId);
  });

  test("タブが1枚だけのタイルは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/cycle-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, direction: "next" }),
    });

    expect(res.status).toBe(404);
  });

  test("未知のdirectionは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/cycle-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, direction: "up" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /close-tab", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("対象タブを閉じる", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newTab(tileId);
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/close-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, tabId: firstTabId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mgr.hasTab(firstTabId)).toBe(false);
  });

  test("ワークスペース最後の1枚のタイルの最後のタブは閉じられず404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const leaf = mgr.snapshot().workspace.board.layout as TileLeaf;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/close-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: leaf.id, tabId: leaf.activeTabId }),
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /respawn-tab", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("対象タブを再起動する", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/respawn-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: firstTabId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("存在しないtabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/respawn-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("未知のshellProfileIdは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/respawn-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: firstTabId, shellProfileId: "unknown" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /focus-tile", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("対象タイルへフォーカスを移す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/focus-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: firstTileId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mgr.snapshot().workspace.board.focusedTileId).toBe(firstTileId);
  });

  test("存在しないtileIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/focus-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /focus-direction", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("指定方向の隣接タイルへフォーカスを移す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    mgr.focusTile(firstTileId);
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/focus-direction", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ direction: "right" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mgr.snapshot().workspace.board.focusedTileId).not.toBe(firstTileId);
  });

  test("不正なdirectionは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/focus-direction", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ direction: "diagonal" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /zoom-tile", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("1回目でズームON、2回目でOFFに戻る。トグル後の状態を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const on = await fetch("http://localhost/zoom-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId }),
    });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ ok: true, zoomed: true });
    expect(mgr.snapshot().workspace.board.zoomedTileId).toBe(tileId);

    const off = await fetch("http://localhost/zoom-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId }),
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ ok: true, zoomed: false });
    expect(mgr.snapshot().workspace.board.zoomedTileId).toBeNull();
  });

  test("存在しないtileIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/zoom-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /resize-tile", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("指定方向へタイルを拡大する（既定量）", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/resize-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: firstTileId, direction: "right" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const split = mgr.snapshot().workspace.board.layout as TileSplit;
    expect(split.ratio).toBeCloseTo(0.55, 5);
  });

  test("amountを指定するとその分だけratioが変わる", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/resize-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: firstTileId, direction: "left", amount: 0.2 }),
    });

    expect(res.status).toBe(200);
    const split = mgr.snapshot().workspace.board.layout as TileSplit;
    expect(split.ratio).toBeCloseTo(0.3, 5);
  });

  test("該当軸のsplit祖先が無い場合は404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/resize-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: firstTileId, direction: "right" }),
    });

    expect(res.status).toBe(404);
  });

  test("不正なdirectionは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/resize-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: firstTileId, direction: "diagonal" }),
    });

    expect(res.status).toBe(400);
  });

  test("amountが範囲外(0以下・1超)は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const zero = await fetch("http://localhost/resize-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: firstTileId, direction: "right", amount: 0 }),
    });
    expect(zero.status).toBe(400);

    const tooLarge = await fetch("http://localhost/resize-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId: firstTileId, direction: "right", amount: 1.5 }),
    });
    expect(tooLarge.status).toBe(400);
  });
});

describe("POST /new-workspace, POST /switch-workspace, POST /close-workspace", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("new-workspace: 新規ワークスペースを作成しアクティブにして、workspaceIdを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstId = mgr.snapshot().activeWorkspaceId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-workspace", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; workspaceId: string };
    expect(body.ok).toBe(true);
    expect(body.workspaceId).not.toBe(firstId);
    expect(mgr.snapshot().activeWorkspaceId).toBe(body.workspaceId);
    expect(mgr.snapshot().workspaceIds).toEqual([firstId, body.workspaceId]);
  });

  test("switch-workspace: 指定したワークスペースへ切り替える", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/switch-workspace", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: firstId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mgr.snapshot().activeWorkspaceId).toBe(firstId);
  });

  test("switch-workspace: 存在しないworkspaceIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/switch-workspace", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("close-workspace: 非アクティブなワークスペースを閉じる", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;
    mgr.switchWorkspace(firstId);
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/close-workspace", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: secondId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mgr.snapshot().workspaceIds).toEqual([firstId]);
  });

  test("close-workspace: 存在しないworkspaceIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/close-workspace", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("close-workspace: 最後の1つのワークスペースは409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const onlyId = mgr.snapshot().activeWorkspaceId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/close-workspace", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: onlyId }),
    });

    expect(res.status).toBe(409);
  });
});

describe("POST /move-workspace", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function moveWorkspace(workspaceId: string, direction: string): Promise<Response> {
    return fetch("http://localhost/move-workspace", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, direction }),
    });
  }

  test("direction: downで1つ後ろへ移動する", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;
    server = await createIpcServer(socketPath, mgr);

    const res = await moveWorkspace(firstId, "down");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mgr.snapshot().workspaceIds).toEqual([secondId, firstId]);
  });

  test("direction: upで1つ手前へ移動する", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstId = mgr.snapshot().activeWorkspaceId;
    mgr.newWorkspace();
    const secondId = mgr.snapshot().activeWorkspaceId;
    server = await createIpcServer(socketPath, mgr);

    const res = await moveWorkspace(secondId, "up");

    expect(res.status).toBe(200);
    expect(mgr.snapshot().workspaceIds).toEqual([secondId, firstId]);
  });

  test("端でこれ以上動かせない場合もokを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const onlyId = mgr.snapshot().activeWorkspaceId;
    server = await createIpcServer(socketPath, mgr);

    const res = await moveWorkspace(onlyId, "up");

    expect(res.status).toBe(200);
    expect(mgr.snapshot().workspaceIds).toEqual([onlyId]);
  });

  test("存在しないworkspaceIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    expect((await moveWorkspace("not-found", "up")).status).toBe(404);
  });

  test("未知のdirectionは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const onlyId = mgr.snapshot().activeWorkspaceId;
    server = await createIpcServer(socketPath, mgr);

    expect((await moveWorkspace(onlyId, "sideways")).status).toBe(400);
  });
});

describe("POST /move-board", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function moveBoard(boardId: string, direction: string): Promise<Response> {
    return fetch("http://localhost/move-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId, direction }),
    });
  }

  function listBoardIds(mgr: WorkspaceManager): string[] {
    return mgr.snapshot().workspace.boardIds;
  }

  test("direction: downで1つ後ろへ移動する", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstId = mgr.snapshot().workspace.activeBoardId;
    const secondId = mgr.newBoard(workspaceId) as string;
    server = await createIpcServer(socketPath, mgr);

    const res = await moveBoard(firstId, "down");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(listBoardIds(mgr)).toEqual([secondId, firstId]);
  });

  test("direction: upで1つ手前へ移動する", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstId = mgr.snapshot().workspace.activeBoardId;
    const secondId = mgr.newBoard(workspaceId) as string;
    server = await createIpcServer(socketPath, mgr);

    const res = await moveBoard(secondId, "up");

    expect(res.status).toBe(200);
    expect(listBoardIds(mgr)).toEqual([secondId, firstId]);
  });

  test("端でこれ以上動かせない場合もokを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const onlyId = mgr.snapshot().workspace.activeBoardId;
    server = await createIpcServer(socketPath, mgr);

    const res = await moveBoard(onlyId, "up");

    expect(res.status).toBe(200);
    expect(listBoardIds(mgr)).toEqual([onlyId]);
  });

  test("存在しないboardIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    expect((await moveBoard("not-found", "up")).status).toBe(404);
  });

  test("未知のdirectionは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const onlyId = mgr.snapshot().workspace.activeBoardId;
    server = await createIpcServer(socketPath, mgr);

    expect((await moveBoard(onlyId, "sideways")).status).toBe(400);
  });
});

describe("POST /move-board-to-workspace", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function moveBoardToWorkspace(boardId: string, workspaceId: string): Promise<Response> {
    return fetch("http://localhost/move-board-to-workspace", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId, workspaceId }),
    });
  }

  /** ワークスペースAに2つ、ワークスペースBに1つBoardがある状態を作る */
  function createTwoWorkspaces(mgr: WorkspaceManager) {
    const wsA = mgr.snapshot().activeWorkspaceId;
    const boardA1 = mgr.snapshot().workspace.activeBoardId;
    const boardA2 = mgr.newBoard(wsA) as string;
    const wsB = mgr.newWorkspace();
    mgr.switchWorkspace(wsA);
    return { wsA, wsB, boardA1, boardA2 };
  }

  function boardIdsOf(mgr: WorkspaceManager, workspaceId: string): string[] | undefined {
    return mgr
      .listWorkspaces()
      .find((e) => e.workspaceId === workspaceId)
      ?.boards.map((b) => b.boardId);
  }

  test("指定したワークスペースの末尾へ移動する", async () => {
    const { mgr } = createTestWorkspaceManager();
    const { wsA, wsB, boardA1, boardA2 } = createTwoWorkspaces(mgr);
    server = await createIpcServer(socketPath, mgr);

    const res = await moveBoardToWorkspace(boardA2, wsB);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sourceWorkspaceClosed: false });
    expect(boardIdsOf(mgr, wsA)).toEqual([boardA1]);
    expect(boardIdsOf(mgr, wsB)?.at(-1)).toBe(boardA2);
  });

  test("移動元が空になった場合はsourceWorkspaceClosedで知らせる", async () => {
    const { mgr } = createTestWorkspaceManager();
    const { wsA, wsB, boardA1, boardA2 } = createTwoWorkspaces(mgr);
    server = await createIpcServer(socketPath, mgr);

    await moveBoardToWorkspace(boardA2, wsB);
    const res = await moveBoardToWorkspace(boardA1, wsB);

    expect(await res.json()).toEqual({ ok: true, sourceWorkspaceClosed: true });
    expect(mgr.snapshot().workspaceIds).toEqual([wsB]);
    expect(boardIdsOf(mgr, wsA)).toBeUndefined();
  });

  test("存在しないboardId・workspaceIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const { wsB, boardA2 } = createTwoWorkspaces(mgr);
    server = await createIpcServer(socketPath, mgr);

    expect((await moveBoardToWorkspace("not-found", wsB)).status).toBe(404);
    expect((await moveBoardToWorkspace(boardA2, "not-found")).status).toBe(404);
  });

  test("workspaceIdが無いbodyは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const boardId = mgr.snapshot().workspace.activeBoardId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/move-board-to-workspace", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /new-board, POST /switch-board, POST /close-board, POST /rename-board", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("new-board: workspaceId省略時はアクティブなワークスペースに作成しboardIdを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; boardId: string };
    expect(body.ok).toBe(true);
    expect(body.boardId).not.toBe(firstBoardId);
    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.activeBoardId).toBe(body.boardId);
  });

  test("new-board: activate=falseならBoardは増えるがアクティブは変わらない", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activate: false }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; boardId: string };
    expect(body.boardId).not.toBe(firstBoardId);
    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.map((b) => b.boardId)).toContain(body.boardId);
    expect(entry?.activeBoardId).toBe(firstBoardId);
  });

  test("new-board: worktreePathを渡すと/listのBoardに載る", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: "/repo/work/feature" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { boardId: string };
    const listed = await fetch("http://localhost/list", { unix: socketPath });
    const listBody = (await listed.json()) as {
      workspaces: { boards: { boardId: string; worktreePath: string | null }[] }[];
    };
    const boards = listBody.workspaces.flatMap((w) => w.boards);
    expect(boards.find((b) => b.boardId === body.boardId)?.worktreePath).toBe("/repo/work/feature");
    expect(boards.filter((b) => b.worktreePath === null)).toHaveLength(1);
  });

  test("new-board: nameを渡すとその名前のBoardができる", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "repo-a" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { boardId: string };
    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.find((b) => b.boardId === body.boardId)?.name).toBe("repo-a");
  });

  test("new-board: nameが空文字列ならデフォルトラベルのままにする", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { boardId: string };
    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.find((b) => b.boardId === body.boardId)?.name).toBeNull();
  });

  test("new-board: nameが文字列以外なら400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 1 }),
    });

    expect(res.status).toBe(400);
  });

  test("new-board: worktreePathが文字列以外なら400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: 1 }),
    });

    expect(res.status).toBe(400);
  });

  test("new-board: activateがboolean以外なら400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activate: "yes" }),
    });

    expect(res.status).toBe(400);
  });

  test("new-board: 存在しないworkspaceIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/new-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("switch-board: 指定したBoardへ切り替える", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    mgr.newBoard(workspaceId);
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/switch-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId: firstBoardId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.activeBoardId).toBe(firstBoardId);
  });

  test("switch-board: 存在しないboardIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/switch-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("close-board: 非アクティブなBoardを閉じる", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const firstBoardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    mgr.newBoard(workspaceId);
    mgr.switchBoard(firstBoardId);
    const secondBoardId = mgr
      .listWorkspaces()
      .find((e) => e.workspaceId === workspaceId)
      ?.boards.find((b) => b.boardId !== firstBoardId)?.boardId as string;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/close-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId: secondBoardId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.map((b) => b.boardId)).toEqual([firstBoardId]);
  });

  test("close-board: 存在しないboardIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/close-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("close-board: ワークスペース内最後の1つのBoardは409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const onlyBoardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/close-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId: onlyBoardId }),
    });

    expect(res.status).toBe(409);
  });

  test("rename-board: 名前を設定できる", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const boardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/rename-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId, name: "repo-a" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.find((b) => b.boardId === boardId)?.name).toBe("repo-a");
  });

  test("rename-board: 空文字列を渡すとデフォルトラベルへリセットされる", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const boardId = mgr.listWorkspaces()[0]?.activeBoardId as string;
    mgr.setBoardName(boardId, "repo-a");
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/rename-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId, name: "" }),
    });

    expect(res.status).toBe(200);
    const entry = mgr.listWorkspaces().find((e) => e.workspaceId === workspaceId);
    expect(entry?.boards.find((b) => b.boardId === boardId)?.name).toBeNull();
  });

  test("rename-board: 存在しないboardIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/rename-board", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId: "not-found", name: "x" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /browser-navigate, GET /browser-get-text, GET /browser-get-html", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("browser-navigate: 対象がブラウザタブでアクティブなワークスペースならbrowserBridge.navigateを呼びok:trueを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    let received: unknown;
    const bridge = createFakeBrowserBridge({
      navigate: async (t, u) => {
        received = { tabId: t, url: u };
        return { ok: true };
      },
    });
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      bridge,
    );

    const res = await fetch("http://localhost/browser-navigate", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId, url: "https://example.org" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(received).toEqual({ tabId, url: "https://example.org" });
  });

  test("browser-navigate: 成功時にworkspaceManager側のURLも更新される（永続化対象への追従）", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge({ navigate: async () => ({ ok: true }) }),
    );

    await fetch("http://localhost/browser-navigate", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId, url: "https://example.org" }),
    });

    expect(mgr.snapshot().workspace.board.tabs[tabId]).toEqual({
      kind: "browser",
      url: "https://example.org",
    });
  });

  test("browser-navigate: 存在しないtabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
    );

    const res = await fetch("http://localhost/browser-navigate", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: "not-found", url: "https://example.com" }),
    });

    expect(res.status).toBe(404);
  });

  test("browser-navigate: terminalタブを指定すると404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const terminalTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
    );

    const res = await fetch("http://localhost/browser-navigate", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: terminalTabId, url: "https://example.com" }),
    });

    expect(res.status).toBe(404);
  });

  test("browser-navigate: 対象タブの所属ワークスペースが非アクティブなら409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    mgr.newWorkspace(); // 以後、tabId所属のworkspaceは非アクティブ
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
    );

    const res = await fetch("http://localhost/browser-navigate", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId, url: "https://example.com" }),
    });

    expect(res.status).toBe(409);
  });

  test("browser-navigate: urlが空/未指定は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
    );

    const res = await fetch("http://localhost/browser-navigate", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId, url: "" }),
    });

    expect(res.status).toBe(400);
  });

  test("browser-navigate: browserBridge.navigateが失敗を返すと409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    const bridge = createFakeBrowserBridge({
      navigate: async () => ({ ok: false, error: "navigation timed out waiting for page load" }),
    });
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      bridge,
    );

    const res = await fetch("http://localhost/browser-navigate", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId, url: "https://example.com" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      error: "navigation timed out waiting for page load",
    });
  });

  test("browser-get-text: 対象がブラウザタブでアクティブなワークスペースならテキストを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    const bridge = createFakeBrowserBridge({
      getText: async () => ({ ok: true, text: "Example Domain" }),
    });
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      bridge,
    );

    const res = await fetch(`http://localhost/browser-get-text?tabId=${tabId}`, {
      unix: socketPath,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, text: "Example Domain" });
  });

  test("browser-get-text: terminalタブは404、tabId未指定は400、非アクティブワークスペースは409", async () => {
    const { mgr } = createTestWorkspaceManager();
    const terminalTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const browserTabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    mgr.newWorkspace();
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
    );

    const terminalRes = await fetch(`http://localhost/browser-get-text?tabId=${terminalTabId}`, {
      unix: socketPath,
    });
    expect(terminalRes.status).toBe(404);

    const missingRes = await fetch("http://localhost/browser-get-text", { unix: socketPath });
    expect(missingRes.status).toBe(400);

    const inactiveRes = await fetch(`http://localhost/browser-get-text?tabId=${browserTabId}`, {
      unix: socketPath,
    });
    expect(inactiveRes.status).toBe(409);
  });

  test("browser-get-html: 対象がブラウザタブでアクティブなワークスペースならHTMLを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    const bridge = createFakeBrowserBridge({
      getHtml: async () => ({ ok: true, html: "<html><body>hi</body></html>" }),
    });
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      bridge,
    );

    const res = await fetch(`http://localhost/browser-get-html?tabId=${tabId}`, {
      unix: socketPath,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, html: "<html><body>hi</body></html>" });
  });

  test("browser-get-html: 存在しないtabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
    );

    const res = await fetch("http://localhost/browser-get-html?tabId=not-found", {
      unix: socketPath,
    });

    expect(res.status).toBe(404);
  });

  test("browserBridgeを渡さない場合はデフォルトのUNAVAILABLE扱いで409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch(`http://localhost/browser-get-text?tabId=${tabId}`, {
      unix: socketPath,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "browser bridge not available" });
  });
});

describe("GET /browser-screenshot", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("対象がブラウザタブでアクティブなワークスペースならgetUrl→captureScreenshotの順で呼びPNGを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    const bridge = createFakeBrowserBridge({
      getUrl: async () => ({ ok: true, url: "https://example.com/" }),
    });
    let receivedUrl: unknown;
    const captureScreenshot = createFakeCaptureScreenshot(async (url) => {
      receivedUrl = url;
      return { ok: true, data: new Blob(["fake-png-bytes"]) };
    });
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      bridge,
      captureScreenshot,
    );

    const res = await fetch(`http://localhost/browser-screenshot?tabId=${tabId}`, {
      unix: socketPath,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("fake-png-bytes");
    expect(receivedUrl).toBe("https://example.com/");
  });

  test("存在しないtabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
      createFakeCaptureScreenshot(),
    );

    const res = await fetch("http://localhost/browser-screenshot?tabId=not-found", {
      unix: socketPath,
    });

    expect(res.status).toBe(404);
  });

  test("terminalタブを指定すると404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const terminalTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
      createFakeCaptureScreenshot(),
    );

    const res = await fetch(`http://localhost/browser-screenshot?tabId=${terminalTabId}`, {
      unix: socketPath,
    });

    expect(res.status).toBe(404);
  });

  test("tabId未指定は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
      createFakeCaptureScreenshot(),
    );

    const res = await fetch("http://localhost/browser-screenshot", { unix: socketPath });

    expect(res.status).toBe(400);
  });

  test("対象タブの所属ワークスペースが非アクティブなら409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    mgr.newWorkspace();
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
      createFakeCaptureScreenshot(),
    );

    const res = await fetch(`http://localhost/browser-screenshot?tabId=${tabId}`, {
      unix: socketPath,
    });

    expect(res.status).toBe(409);
  });

  test("browserBridge.getUrlが失敗を返すと409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    const bridge = createFakeBrowserBridge({
      getUrl: async () => ({ ok: false, error: "page not loaded yet" }),
    });
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      bridge,
      createFakeCaptureScreenshot(),
    );

    const res = await fetch(`http://localhost/browser-screenshot?tabId=${tabId}`, {
      unix: socketPath,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "page not loaded yet" });
  });

  test("captureScreenshotが失敗を返すと409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    const captureScreenshot = createFakeCaptureScreenshot(async () => ({
      ok: false,
      error: "navigation timed out",
    }));
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {},
      createFakeBrowserBridge(),
      captureScreenshot,
    );

    const res = await fetch(`http://localhost/browser-screenshot?tabId=${tabId}`, {
      unix: socketPath,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "navigation timed out" });
  });

  test("browserBridgeを渡さない場合はデフォルトのUNAVAILABLE扱いで409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabId = mgr.newBrowserTab(tileId, "https://example.com") as string;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch(`http://localhost/browser-screenshot?tabId=${tabId}`, {
      unix: socketPath,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "browser bridge not available" });
  });
});

describe("POST /notify", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("titleを渡すとsendNotificationへそのまま渡り、ok:trueを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const notified: unknown[] = [];
    server = await createIpcServer(
      socketPath,
      mgr,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (opts) => notified.push(opts),
    );

    const res = await fetch("http://localhost/notify", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "ビルド完了", body: "npm run build", silent: true }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(notified).toEqual([{ title: "ビルド完了", body: "npm run build", silent: true }]);
  });

  test("title未指定は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/notify", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "本文だけ" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /sidebar-view", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  const views = [{ id: "notes", name: "Notes", url: "file:///tmp/notes.html", handlerNames: [] }];

  /** setSidebarViewはcreateIpcServerの最後の引数なので、間の既定値はundefinedで埋める */
  function createServerWith(requested: string[]) {
    const { mgr } = createTestWorkspaceManager();
    return createIpcServer(
      socketPath,
      mgr,
      () => views,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (viewId) => requested.push(viewId),
    );
  }

  test("customViewのidを指定すると、そのビューへの切替がwebviewへ渡る", async () => {
    const requested: string[] = [];
    server = await createServerWith(requested);

    const res = await fetch("http://localhost/sidebar-view", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "notes" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, viewId: "notes" });
    expect(requested).toEqual(["notes"]);
  });

  test("ワークスペース一覧のidも指定できる", async () => {
    const requested: string[] = [];
    server = await createServerWith(requested);

    const res = await fetch("http://localhost/sidebar-view", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "workspaces" }),
    });

    expect(res.status).toBe(200);
    expect(requested).toEqual(["workspaces"]);
  });

  test("未知のidは404を返し、切替を送らない", async () => {
    const requested: string[] = [];
    server = await createServerWith(requested);

    const res = await fetch("http://localhost/sidebar-view", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: "missing" }),
    });

    expect(res.status).toBe(404);
    expect(requested).toEqual([]);
  });

  test("viewId未指定は400を返す", async () => {
    const requested: string[] = [];
    server = await createServerWith(requested);

    const res = await fetch("http://localhost/sidebar-view", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /show-tab", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("非アクティブなワークスペースのタブでも、切替・フォーカス・アクティブ化・ウィンドウ前面化を行いok:trueを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const firstId = mgr.snapshot().activeWorkspaceId;
    const firstTileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newTab(firstTileId);
    mgr.newWorkspace(); // 以後firstIdは非アクティブ
    let activated = false;
    server = await createIpcServer(
      socketPath,
      mgr,
      () => [],
      () => {
        activated = true;
      },
    );

    const res = await fetch("http://localhost/show-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: firstTabId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, workspaceId: firstId, tileId: firstTileId });
    expect(mgr.snapshot().activeWorkspaceId).toBe(firstId);
    expect((mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId).toBe(firstTabId);
    expect(mgr.snapshot().workspace.board.focusedTileId).toBe(firstTileId);
    expect(activated).toBe(true);
  });

  test("存在しないtabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/show-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("tabId未指定は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/show-tab", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /set-var, GET /get-var, GET /list-vars", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("set-varで書いた値をget-var/list-varsで読める", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const setRes = await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId, key: "status", value: "running" }),
    });
    expect(setRes.status).toBe(200);
    expect(await setRes.json()).toEqual({ ok: true });

    const getRes = await fetch(`http://localhost/get-var?tabId=${tabId}&key=status`, {
      unix: socketPath,
    });
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ ok: true, value: "running" });

    const listRes = await fetch(`http://localhost/list-vars?tabId=${tabId}`, {
      unix: socketPath,
    });
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({ ok: true, vars: { status: "running" } });
  });

  test("別タイル(tileB)からtabAの変数を読める（tabBに書いても混ざらない）", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileA = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const splitResult = mgr.splitTile(tileA, "vertical");
    const tabB = splitResult?.tabId as string;
    server = await createIpcServer(socketPath, mgr);

    await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: tabA, key: "status", value: "from-a" }),
    });

    // tabB視点からtabAのtabIdを指定して読む（別タブからの参照を模す）
    const getFromB = await fetch(`http://localhost/get-var?tabId=${tabA}&key=status`, {
      unix: socketPath,
    });
    expect(await getFromB.json()).toEqual({ ok: true, value: "from-a" });

    // tabB自身にはまだ設定されていない
    const getB = await fetch(`http://localhost/get-var?tabId=${tabB}&key=status`, {
      unix: socketPath,
    });
    expect(getB.status).toBe(404);
  });

  test("同一タイル内の別タブ(tabB)で変数が混ざらない", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const tabB = mgr.newTab(tileId) as string;
    server = await createIpcServer(socketPath, mgr);

    await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: tabA, key: "agent_status", value: "working" }),
    });
    await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: tabB, key: "agent_status", value: "idle" }),
    });

    const getA = await fetch(`http://localhost/get-var?tabId=${tabA}&key=agent_status`, {
      unix: socketPath,
    });
    expect(await getA.json()).toEqual({ ok: true, value: "working" });

    const getB = await fetch(`http://localhost/get-var?tabId=${tabB}&key=agent_status`, {
      unix: socketPath,
    });
    expect(await getB.json()).toEqual({ ok: true, value: "idle" });
  });

  test("set-var: 不正なkey（空白を含む）は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId, key: "bad key", value: "v" }),
    });

    expect(res.status).toBe(400);
  });

  test("set-var: 存在しないtabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: "not-found", key: "k", value: "v" }),
    });

    expect(res.status).toBe(404);
  });

  test("get-var: tabId/keyクエリ未指定は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/get-var", { unix: socketPath });
    expect(res.status).toBe(400);
  });

  test("get-var: 存在するtabIdだが未設定のkeyは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch(`http://localhost/get-var?tabId=${tabId}&key=not-set`, {
      unix: socketPath,
    });
    expect(res.status).toBe(404);
  });

  test("list-vars: tabId未指定は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/list-vars", { unix: socketPath });
    expect(res.status).toBe(400);
  });

  test("list-vars: 存在しないtabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/list-vars?tabId=not-found", {
      unix: socketPath,
    });
    expect(res.status).toBe(404);
  });

  test("list-vars: 何も設定していないtabIdは空オブジェクトを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tabId = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch(`http://localhost/list-vars?tabId=${tabId}`, {
      unix: socketPath,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, vars: {} });
  });

  test("find-vars: scopeTabIdの所属Board内のみ検索し、同じワークスペースの別Boardは含まない", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.listWorkspaces()[0]?.workspaceId as string;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    // 同じワークスペースへ2枚目のBoardを作る（同じレイアウトプリセットを2回適用した状況）
    mgr.newBoard(workspaceId);
    const tileB = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabB = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const tabB2 = mgr.splitTile(tileB, "vertical")?.tabId as string;
    server = await createIpcServer(socketPath, mgr);

    await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: tabA, key: "role", value: "claude" }),
    });
    await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: tabB2, key: "role", value: "claude" }),
    });

    // tabB（2枚目のBoard）を起点にすると、1枚目のBoardのtabAは見つからない
    const res = await fetch(`http://localhost/find-vars?key=role&value=claude&scopeTabId=${tabB}`, {
      unix: socketPath,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tabIds: [tabB2] });
  });

  test("find-vars: boardIdを明示するとscopeTabIdの所属Boardより優先される", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.listWorkspaces()[0]?.workspaceId as string;
    const boardA = mgr.listWorkspaces()[0]?.activeBoardId as string;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newBoard(workspaceId);
    const tabB = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: tabA, key: "role", value: "claude" }),
    });
    await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: tabB, key: "role", value: "claude" }),
    });

    const res = await fetch(
      `http://localhost/find-vars?key=role&value=claude&boardId=${boardA}&scopeTabId=${tabB}`,
      { unix: socketPath },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tabIds: [tabA] });
  });

  test("find-vars: boardId・scopeTabId未指定はアクティブBoardを検索する", async () => {
    const { mgr } = createTestWorkspaceManager();
    const workspaceId = mgr.listWorkspaces()[0]?.workspaceId as string;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    // newBoardで2枚目がアクティブになる
    mgr.newBoard(workspaceId);
    const tabB = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    server = await createIpcServer(socketPath, mgr);

    await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: tabA, key: "role", value: "claude" }),
    });
    await fetch("http://localhost/set-var", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabId: tabB, key: "role", value: "claude" }),
    });

    const res = await fetch("http://localhost/find-vars?key=role&value=claude", {
      unix: socketPath,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tabIds: [tabB] });
  });

  test("find-vars: 存在しないscopeTabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch(
      "http://localhost/find-vars?key=role&value=claude&scopeTabId=not-found",
      {
        unix: socketPath,
      },
    );
    expect(res.status).toBe(404);
  });

  test("find-vars: 存在しないboardIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/find-vars?key=role&value=claude&boardId=not-found", {
      unix: socketPath,
    });
    expect(res.status).toBe(404);
  });

  test("find-vars: key/value未指定は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/find-vars?key=role", { unix: socketPath });
    expect(res.status).toBe(400);
  });
});

describe("GET /layouts, POST /apply-layout", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  const LAYOUTS: LayoutsConfig = {
    dev: {
      description: "Editor + terminal",
      layout: { kind: "tile", tabs: [{ name: "editor", command: "nvim" }] },
    },
    broken: {
      layout: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ focus: true }] },
        second: { kind: "tile", tabs: [{ focus: true }] },
      },
    },
  };

  function createServerWithLayouts(layouts: LayoutsConfig) {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    return {
      mgr,
      sessionOpts,
      serverPromise: createIpcServer(
        socketPath,
        mgr,
        () => [],
        () => {},
        undefined,
        undefined,
        () => [],
        () => layouts,
      ),
    };
  }

  test("GET /layouts: getLayouts未指定時は空配列を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/layouts", { unix: socketPath });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, layouts: [] });
  });

  // 解決元(projectRoot)を必ず載せる。プロジェクトローカルのプリセットと同名になりうるため、
  // CLI側はこれを見てどちらが適用されるかを表示する
  test("GET /layouts: 設定済みプリセットをname/description/projectRootの一覧として返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/layouts", { unix: socketPath });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; layouts: unknown[] };
    expect(body.layouts).toEqual([
      { name: "broken", projectRoot: null },
      { name: "dev", description: "Editor + terminal", projectRoot: null },
    ]);
  });

  test("POST /apply-layout: 新規Boardとして適用し、boardIdを返す", async () => {
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;
    const firstBoardId = mgr.snapshot().workspace.activeBoardId;
    const workspaceCountBefore = mgr.snapshot().workspaceIds.length;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; boardId: string };
    expect(body.ok).toBe(true);
    expect(body.boardId).not.toBe(firstBoardId);
    // new-boardはアクティブworkspace配下に作るだけで、新規workspaceは作らない
    expect(mgr.snapshot().workspaceIds.length).toBe(workspaceCountBefore);
    expect(mgr.snapshot().workspace.activeBoardId).toBe(body.boardId);
  });

  test("POST /apply-layout: workspaceIdを指定すると、そのworkspace配下に新規Boardを作る", async () => {
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;
    const otherWorkspaceId = mgr.newWorkspace();
    mgr.switchWorkspace(mgr.snapshot().workspaceIds[0] as string);
    const activeWorkspaceId = mgr.snapshot().activeWorkspaceId;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", workspaceId: otherWorkspaceId }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; boardId: string };
    expect(body.ok).toBe(true);
    // アクティブworkspaceは変わらない（指定先のworkspaceにBoardが追加されるだけ）
    expect(mgr.snapshot().activeWorkspaceId).toBe(activeWorkspaceId);
    const entry = mgr.listWorkspaces().find((w) => w.workspaceId === otherWorkspaceId);
    expect(entry?.boards.some((b) => b.boardId === body.boardId)).toBe(true);
  });

  test("POST /apply-layout: 存在しないworkspaceIdは404を返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", workspaceId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("POST /apply-layout: cwdを指定すると、cwd未指定のタブへ既定値として渡る", async () => {
    const { mgr, sessionOpts, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", cwd: "/invocation/dir" }),
    });
    resolvePending(mgr);

    expect(res.status).toBe(200);
    expect(sessionOpts.some((o) => o.cwd === "/invocation/dir")).toBe(true);
  });

  test("POST /apply-layout: tabCwdはcwdより優先してタブへ渡る", async () => {
    const { mgr, sessionOpts, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", cwd: "/repo/main", tabCwd: "/repo/work/feature" }),
    });
    resolvePending(mgr);

    expect(res.status).toBe(200);
    expect(sessionOpts.some((o) => o.cwd === "/repo/work/feature")).toBe(true);
    expect(sessionOpts.some((o) => o.cwd === "/repo/main")).toBe(false);
  });

  test("POST /apply-layout: tabCwdが空文字列なら400を返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", tabCwd: "" }),
    });

    expect(res.status).toBe(400);
  });

  test("POST /apply-layout: target:replaceは現在アクティブなBoardを置き換える", async () => {
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;
    const activeBoardId = mgr.snapshot().workspace.activeBoardId;
    const workspaceCountBefore = mgr.snapshot().workspaceIds.length;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", target: "replace" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; boardId: string };
    expect(body.boardId).toBe(activeBoardId);
    expect(mgr.snapshot().workspaceIds.length).toBe(workspaceCountBefore);
  });

  test("POST /apply-layout: target:replaceでboardIdを指定すると、そのBoardを置き換える", async () => {
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;
    const workspaceId = mgr.snapshot().activeWorkspaceId;
    const otherBoardId = mgr.newBoard(workspaceId) as string;
    // アクティブBoardをotherBoardId以外へ戻しておく（指定なしなら誤って選ばれるはず）
    mgr.switchBoard(mgr.snapshot().workspace.boardIds[0] as string);

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", target: "replace", boardId: otherBoardId }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; boardId: string };
    expect(body.boardId).toBe(otherBoardId);
  });

  test("POST /apply-layout: target:replaceで存在しないboardIdは404を返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", target: "replace", boardId: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("POST /apply-layout: 存在しないnameは404を返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("POST /apply-layout: nameが不正なボディは400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test("POST /apply-layout: 検証に失敗するプリセット（focus重複）は400を返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "broken" }),
    });

    expect(res.status).toBe(400);
  });

  test("POST /apply-layout: 適用したプリセット名をBoardに記録する（既定はrestoreMode: restore）", async () => {
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev" }),
    });

    const body = (await res.json()) as { boardId: string };
    expect(mgr.getBoardStartup(body.boardId)).toEqual({ preset: "dev", restoreMode: "restore" });
    expect(mgr.listStartupLayoutBoards()).toEqual([]);
  });

  test("POST /apply-layout: startup:trueなら起動時レイアウトの対象になる", async () => {
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", startup: true }),
    });

    const body = (await res.json()) as { boardId: string };
    expect(mgr.getBoardStartup(body.boardId)).toEqual({ preset: "dev", restoreMode: "layout" });
    expect(mgr.listStartupLayoutBoards()).toEqual([{ boardId: body.boardId, preset: "dev" }]);
  });

  test("POST /apply-layout: startupがboolean以外のボディは400を返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", startup: "yes" }),
    });

    expect(res.status).toBe(400);
  });

  test("POST /board-worktree: mode:setで紐づけを設定し、boardId省略時はアクティブBoardが対象", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);
    const boardId = mgr.snapshot().workspace.activeBoardId;

    const res = await fetch("http://localhost/board-worktree", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "set", path: "/repo/work/feature" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      boardId,
      worktreePath: "/repo/work/feature",
      missing: false,
    });
    expect(mgr.getBoardWorktreePath(boardId)).toBe("/repo/work/feature");
  });

  test("POST /board-worktree: mode:clearで紐づけを解除する", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);
    const boardId = mgr.snapshot().workspace.activeBoardId;
    mgr.setBoardWorktreePath(boardId, "/repo/work/feature");

    const res = await fetch("http://localhost/board-worktree", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "clear", boardId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, boardId, worktreePath: null, missing: false });
    expect(mgr.getBoardWorktreePath(boardId)).toBeNull();
  });

  test("POST /board-worktree: mode:showは紐づけを変えずに現在値を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);
    const boardId = mgr.snapshot().workspace.activeBoardId;
    mgr.setBoardWorktreePath(boardId, "/repo/work/feature");

    const res = await fetch("http://localhost/board-worktree", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "show", boardId }),
    });

    expect(await res.json()).toEqual({
      ok: true,
      boardId,
      worktreePath: "/repo/work/feature",
      missing: false,
    });
    expect(mgr.getBoardWorktreePath(boardId)).toBe("/repo/work/feature");
  });

  test("POST /board-worktree: mode:setでpath省略は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/board-worktree", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "set" }),
    });

    expect(res.status).toBe(400);
  });

  test("POST /board-worktree: 存在しないboardIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/board-worktree", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "show", boardId: "board-nope" }),
    });

    expect(res.status).toBe(404);
  });

  test("POST /board-startup: presetを指定してmode:layoutに切り替えられる", async () => {
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;
    const boardId = mgr.snapshot().workspace.activeBoardId;

    const res = await fetch("http://localhost/board-startup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "layout", preset: "dev" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      boardId,
      startup: { preset: "dev", restoreMode: "layout" },
    });
    expect(mgr.listStartupLayoutBoards()).toEqual([{ boardId, preset: "dev" }]);
  });

  test("POST /board-startup: preset省略時は既に紐づいているプリセットを引き継ぐ", async () => {
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;
    const boardId = mgr.snapshot().workspace.activeBoardId;
    mgr.setBoardStartup(boardId, { preset: "dev", restoreMode: "restore" });

    const res = await fetch("http://localhost/board-startup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "layout", boardId }),
    });

    expect(res.status).toBe(200);
    expect(mgr.getBoardStartup(boardId)).toEqual({ preset: "dev", restoreMode: "layout" });
  });

  test("POST /board-startup: mode:clearで紐づけを解除する", async () => {
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;
    const boardId = mgr.snapshot().workspace.activeBoardId;
    mgr.setBoardStartup(boardId, { preset: "dev", restoreMode: "layout" });

    const res = await fetch("http://localhost/board-startup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "clear", boardId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, boardId, startup: null });
    expect(mgr.getBoardStartup(boardId)).toBeNull();
  });

  test("POST /board-startup: プリセット未紐づけでpreset省略は400を返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/board-startup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "layout" }),
    });

    expect(res.status).toBe(400);
  });

  test("POST /board-startup: 設定に存在しないpresetは404を返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/board-startup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "layout", preset: "not-found" }),
    });

    expect(res.status).toBe(404);
  });

  test("POST /board-startup: 存在しないboardIdは404、不正なmodeは400を返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const notFound = await fetch("http://localhost/board-startup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "clear", boardId: "board-nope" }),
    });
    expect(notFound.status).toBe(404);

    const badMode = await fetch("http://localhost/board-startup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "preset" }),
    });
    expect(badMode.status).toBe(400);
  });

  // --- プロジェクトローカルのプリセット ---

  /** <dir>/proj/.niwaterm/config.ts に同名の"dev"プリセットを置き、そのルートを返す */
  async function createProjectWithDevPreset(): Promise<string> {
    const projectRoot = join(dir, "proj");
    await mkdir(join(projectRoot, ".niwaterm"), { recursive: true });
    await writeFile(
      join(projectRoot, ".niwaterm", "config.ts"),
      `export default {
  layouts: {
    dev: { description: "project dev", layout: { kind: "tile", tabs: [{ name: "proj" }] } },
  },
};
`,
    );
    return projectRoot;
  }

  test("GET /layouts: cwdを渡すとプロジェクトローカルのプリセットが同名グローバルより優先される", async () => {
    const projectRoot = await createProjectWithDevPreset();
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch(`http://localhost/layouts?cwd=${encodeURIComponent(projectRoot)}`, {
      unix: socketPath,
    });
    const body = (await res.json()) as {
      layouts: { name: string; description?: string; projectRoot: string | null }[];
    };
    expect(body.layouts).toEqual([
      { name: "dev", description: "project dev", projectRoot },
      { name: "broken", projectRoot: null },
    ]);
  });

  test("POST /apply-layout: cwdから解決したプロジェクトローカルのプリセットを適用し、projectRootを返す", async () => {
    const projectRoot = await createProjectWithDevPreset();
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", cwd: projectRoot }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; boardId: string; projectRoot?: string };
    expect(body.ok).toBe(true);
    expect(body.projectRoot).toBe(projectRoot);
    // 適用しただけ（startup未指定）ならrestoreのまま。解決元は覚えておく
    expect(mgr.getBoardStartup(body.boardId)).toEqual({
      preset: "dev",
      restoreMode: "restore",
      projectRoot,
    });
  });

  test("POST /apply-layout: プロジェクトローカル×startupはtrust無しだとneedsTrustを返し、Boardに触れない", async () => {
    const projectRoot = await createProjectWithDevPreset();
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;
    const boardsBefore = mgr.listWorkspaces().flatMap((w) => w.boards).length;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", cwd: projectRoot, startup: true }),
    });

    const body = (await res.json()) as {
      ok: boolean;
      needsTrust?: { projectRoot: string; preset: string };
    };
    expect(body.ok).toBe(false);
    expect(body.needsTrust).toEqual({ projectRoot, preset: "dev" });
    expect(mgr.listWorkspaces().flatMap((w) => w.boards).length).toBe(boardsBefore);
  });

  test("POST /apply-layout: trust:trueなら適用し、解決元込みで起動時レイアウトに紐づける", async () => {
    const projectRoot = await createProjectWithDevPreset();
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", cwd: projectRoot, startup: true, trust: true }),
    });

    const body = (await res.json()) as { ok: boolean; boardId: string };
    expect(body.ok).toBe(true);
    expect(mgr.getBoardStartup(body.boardId)).toEqual({
      preset: "dev",
      restoreMode: "layout",
      projectRoot,
    });
    expect(mgr.listStartupLayoutBoards()).toEqual([
      { boardId: body.boardId, preset: "dev", projectRoot },
    ]);
  });

  test("POST /apply-layout: グローバル由来のプリセットならstartupでもtrustは要らない", async () => {
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", startup: true }),
    });

    const body = (await res.json()) as { ok: boolean; boardId: string };
    expect(body.ok).toBe(true);
    expect(mgr.getBoardStartup(body.boardId)).toEqual({ preset: "dev", restoreMode: "layout" });
  });

  test("POST /apply-layout: グローバル由来×startupは実行ディレクトリも記録する（起動時のcwdの基準になる）", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "niwaterm-apply-layout-cwd-"));
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/apply-layout", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dev", cwd, startup: true }),
    });

    const body = (await res.json()) as { ok: boolean; boardId: string };
    expect(body.ok).toBe(true);
    expect(mgr.getBoardStartup(body.boardId)).toEqual({
      preset: "dev",
      restoreMode: "layout",
      cwd,
    });
    expect(mgr.listStartupLayoutBoards()).toEqual([{ boardId: body.boardId, preset: "dev", cwd }]);
  });

  test("POST /board-startup: プロジェクトローカルのpresetはtrust無しだとneedsTrustを返す", async () => {
    const projectRoot = await createProjectWithDevPreset();
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;
    const boardId = mgr.snapshot().workspace.activeBoardId;

    const withoutTrust = await fetch("http://localhost/board-startup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "layout", boardId, preset: "dev", cwd: projectRoot }),
    });
    const body = (await withoutTrust.json()) as {
      ok: boolean;
      needsTrust?: { projectRoot: string; preset: string };
    };
    expect(body.ok).toBe(false);
    expect(body.needsTrust).toEqual({ projectRoot, preset: "dev" });
    expect(mgr.getBoardStartup(boardId)).toBeNull();

    const withTrust = await fetch("http://localhost/board-startup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "layout",
        boardId,
        preset: "dev",
        cwd: projectRoot,
        trust: true,
      }),
    });
    expect(withTrust.status).toBe(200);
    expect(mgr.getBoardStartup(boardId)).toEqual({
      preset: "dev",
      restoreMode: "layout",
      projectRoot,
    });
  });

  test("POST /board-startup: preset省略時は解決元ごと引き継ぐ（別ディレクトリから叩いても入れ替わらない）", async () => {
    const projectRoot = await createProjectWithDevPreset();
    const { mgr, serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;
    const boardId = mgr.snapshot().workspace.activeBoardId;
    mgr.setBoardStartup(boardId, { preset: "dev", restoreMode: "restore", projectRoot });

    // cwdはプロジェクト外。preset省略なので再解決せず、記録済みのprojectRootを使う
    const res = await fetch("http://localhost/board-startup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "layout", boardId, cwd: dir, trust: true }),
    });

    expect(res.status).toBe(200);
    expect(mgr.getBoardStartup(boardId)).toEqual({
      preset: "dev",
      restoreMode: "layout",
      projectRoot,
    });
  });
});

describe("POST /close-popup, POST /toggle-popup, POST /promote-popup", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("close-popup: 開いているポップアップを閉じる。popup無しは409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const noneRes = await fetch("http://localhost/close-popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(noneRes.status).toBe(409);

    mgr.openPopup();
    const res = await fetch("http://localhost/close-popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mgr.snapshot().workspace.popup).toBeNull();
  });

  test("toggle-popup: 表示/非表示を切り替え、トグル後のvisibleを返す。popup無しは409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const noneRes = await fetch("http://localhost/toggle-popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(noneRes.status).toBe(409);

    mgr.openPopup();
    const res1 = await fetch("http://localhost/toggle-popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res1.status).toBe(200);
    expect(await res1.json()).toEqual({ ok: true, visible: false });

    const res2 = await fetch("http://localhost/toggle-popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ ok: true, visible: true });
  });

  test("promote-popup: フォーカス中タイルへ編入しtileId/tabIdを返す。popup無しは409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const noneRes = await fetch("http://localhost/promote-popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(noneRes.status).toBe(409);

    const popupTabId = mgr.openPopup() as string;
    const res = await fetch("http://localhost/promote-popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tileId, tabId: popupTabId });
    expect(mgr.snapshot().workspace.popup).toBeNull();
    const leaf = mgr.snapshot().workspace.board.layout as TileLeaf;
    expect(leaf.tabIds).toContain(popupTabId);
  });
});

/** fetchのPromiseがまだ解決していないことを確認する（ok:trueだと待ち続けてしまうため） */
async function expectPending(promise: Promise<unknown>): Promise<void> {
  const timeoutSentinel = Symbol("timeout");
  const raceResult = await Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(timeoutSentinel), 50)),
  ]);
  expect(raceResult).toBe(timeoutSentinel);
}

describe("POST /popup", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("ポップアップを開きtabIdを返す。既に開いている場合は409を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; tabId: string };
    expect(body.ok).toBe(true);
    expect(mgr.snapshot().workspace.popup?.tabId).toBe(body.tabId);

    const dupRes = await fetch("http://localhost/popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(dupRes.status).toBe(409);
  });

  test("wait未指定の場合、popupを開いたまま即座にレスポンスを返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "echo hi" }),
    });
    expect(res.status).toBe(200);
    // waitしていないので、コマンドの終了を待たずpopupは開いたまま
    expect(mgr.snapshot().workspace.popup).not.toBeNull();
  });

  test("wait:trueの場合、コマンドが終了する（PTYのonExit発火）までレスポンスを遅らせる", async () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const fetchPromise = fetch("http://localhost/popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "fzf", wait: true }),
    });
    await expectPending(fetchPromise);
    expect(mgr.snapshot().workspace.popup).not.toBeNull();
    // PTYはopenPopup直後ではなく、webview側の実測サイズが届く最初のhandleResizeで
    // 起動する。実際のwebviewの代わりにここで送ってやる
    const tabId = mgr.snapshot().workspace.popup?.tabId as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);

    // popup用セッションが最後に作られたものとして、PTYの自然終了（onExit発火）を模擬する
    const popupSessionOpts = sessionOpts[sessionOpts.length - 1];
    popupSessionOpts?.onExit?.(0);

    const res = await fetchPromise;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; tabId: string };
    expect(body.ok).toBe(true);
    // onExit経由でpopup.close()が呼ばれ、既に閉じている
    expect(mgr.snapshot().workspace.popup).toBeNull();
  });

  test("wait:trueの場合、手動closeでもレスポンスが解決される", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const fetchPromise = fetch("http://localhost/popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wait: true }),
    });
    await expectPending(fetchPromise);

    mgr.closePopup();

    const res = await fetchPromise;
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: true }).ok).toBe(true);
  });

  test("wait:trueの場合、タブへの昇格でもレスポンスが解決される", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const fetchPromise = fetch("http://localhost/popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wait: true }),
    });
    await expectPending(fetchPromise);

    mgr.promotePopup();

    const res = await fetchPromise;
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: true }).ok).toBe(true);
  });

  test("wait以外の不正な型は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wait: "yes" }),
    });
    expect(res.status).toBe(400);
  });

  test("captureStdout:trueの場合、コマンドの標準出力をキャプチャしてstdoutで返す（waitは暗黙で有効）", async () => {
    const { mgr, sessionOpts } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const fetchPromise = fetch("http://localhost/popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "fzf", captureStdout: true }),
    });
    await expectPending(fetchPromise);
    // PTYはopenPopup直後ではなく、webview側の実測サイズが届く最初のhandleResizeで
    // 起動する。実際のwebviewの代わりにここで送ってやる
    const tabId = mgr.snapshot().workspace.popup?.tabId as string;
    mgr.handleResize(tabId, 80, 24, 8, 16);

    const popupSessionOpts = sessionOpts[sessionOpts.length - 1];
    const captureFile = popupSessionOpts?.captureStdoutTo;
    expect(typeof captureFile).toBe("string");
    // PTY内のコマンドがcaptureStdoutToへ書き込む挙動を模擬する（実際のリダイレクトはpty.ts側）
    await writeFile(captureFile as string, "selected-file.txt");
    popupSessionOpts?.onExit?.(0);

    const res = await fetchPromise;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; tabId: string; stdout: string };
    expect(body.ok).toBe(true);
    expect(body.stdout).toBe("selected-file.txt");
    expect(existsSync(captureFile as string)).toBe(false);
  });

  test("captureStdout:trueかつcommand未指定は400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/popup", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captureStdout: true }),
    });
    expect(res.status).toBe(400);
  });
});

describe("ウィンドウ（複数OSウィンドウ）", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  function createFakeSession(): TerminalSession {
    return {
      write: () => {},
      writeWhenReady: () => {},
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
        paletteCss: null,
        copyMode: null,
      }),
      dumpText: () => "",
      isCopyMode: () => false,
      enterCopyMode: () => {},
      exitCopyMode: () => {},
      handleCopyModeKey: () => false,
      setCallbacks: () => {},
      dispose: () => {},
    };
  }

  function createTestWindowManager() {
    return createWindowManager({
      initialCols: 80,
      initialRows: 24,
      onDirty: () => {},
      onWindowOpened: () => {},
      onWindowClosed: () => {},
      onAllWindowsClosed: () => {},
      createSession: () => createFakeSession(),
    });
  }

  /** WindowManagerはWorkspaceManagerとしても振る舞うため、両方の引数へ同じものを渡す */
  function startServer(wm: ReturnType<typeof createTestWindowManager>) {
    return createIpcServer(
      socketPath,
      wm,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      wm,
    );
  }

  /** そのウィンドウのフォーカス中タイルのアクティブタブ */
  function focusedTabId(wm: ReturnType<typeof createTestWindowManager>, windowId: string): string {
    return wm.getActiveTabId(wm.getFocusedTileId(windowId)) as string;
  }

  function post(path: string, body: unknown, tabId?: string) {
    return fetch(`http://localhost${path}`, {
      unix: socketPath,
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(tabId ? { "x-niwaterm-tab-id": tabId } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function get(path: string, tabId?: string) {
    return fetch(`http://localhost${path}`, {
      unix: socketPath,
      ...(tabId ? { headers: { "x-niwaterm-tab-id": tabId } } : {}),
    });
  }

  test("/windowsが開いているウィンドウを返し、/new-windowで増える", async () => {
    const wm = createTestWindowManager();
    server = await startServer(wm);

    const before = (await (await get("/windows")).json()) as {
      windows: { windowId: string; persistent: boolean }[];
    };
    expect(before.windows).toHaveLength(1);
    expect(before.windows[0].persistent).toBe(true);

    const res = await post("/new-window", {});
    expect(res.status).toBe(200);
    const created = (await res.json()) as { ok: true; windowId: string };

    const after = (await (await get("/windows")).json()) as {
      windows: { windowId: string; persistent: boolean }[];
    };
    expect(after.windows).toHaveLength(2);
    expect(after.windows[1]).toMatchObject({ windowId: created.windowId, persistent: false });
  });

  test("/close-windowで閉じ、存在しないidは404", async () => {
    const wm = createTestWindowManager();
    server = await startServer(wm);
    const created = (await (await post("/new-window", {})).json()) as { windowId: string };

    expect((await post("/close-window", { windowId: created.windowId })).status).toBe(200);
    expect((await post("/close-window", { windowId: created.windowId })).status).toBe(404);
    expect(wm.listWindows()).toHaveLength(1);
  });

  test("/listは呼び出し元タブが載っているウィンドウのワークスペースだけを返す", async () => {
    const wm = createTestWindowManager();
    server = await startServer(wm);
    const mainTabId = focusedTabId(wm, wm.mainWindowId);
    const created = (await (await post("/new-window", {})).json()) as { windowId: string };
    // 一時ウィンドウ側にだけワークスペースを増やす
    wm.newWorkspace(undefined, created.windowId);

    const scoped = (await (await get("/list", mainTabId)).json()) as { workspaces: unknown[] };
    expect(scoped.workspaces).toHaveLength(1);

    // ヘッダ無し（niwatermの外からの実行）は最後にフォーカスされたウィンドウ＝一時ウィンドウ
    const focused = (await (await get("/list")).json()) as { workspaces: unknown[] };
    expect(focused.workspaces).toHaveLength(2);
  });

  test("/new-workspaceは呼び出し元タブのウィンドウへ作る", async () => {
    const wm = createTestWindowManager();
    server = await startServer(wm);
    const mainTabId = focusedTabId(wm, wm.mainWindowId);
    const created = (await (await post("/new-window", {})).json()) as { windowId: string };

    const res = await post("/new-workspace", {}, mainTabId);
    expect(res.status).toBe(200);
    expect(wm.snapshotOf(wm.mainWindowId)?.workspaceIds).toHaveLength(2);
    expect(wm.snapshotOf(created.windowId)?.workspaceIds).toHaveLength(1);
  });

  test("別ウィンドウのタブもidを指定すれば操作できる", async () => {
    const wm = createTestWindowManager();
    server = await startServer(wm);
    const mainTabId = focusedTabId(wm, wm.mainWindowId);
    const created = (await (await post("/new-window", {})).json()) as { windowId: string };
    const tempTabId = focusedTabId(wm, created.windowId);

    // メインウィンドウのタブから、一時ウィンドウのタブのタブ変数を設定する
    const res = await post(
      "/set-var",
      { tabId: tempTabId, key: "role", value: "editor" },
      mainTabId,
    );
    expect(res.status).toBe(200);
    expect(wm.getTabVar(tempTabId, "role")).toEqual({ found: true, value: "editor" });
  });

  test("/resolve-targetは呼び出し元タブのウィンドウを起点にフォールバックする", async () => {
    const wm = createTestWindowManager();
    server = await startServer(wm);
    const created = (await (await post("/new-window", {})).json()) as { windowId: string };
    const tempTabId = focusedTabId(wm, created.windowId);

    const res = await get(`/resolve-target?tabId=${tempTabId}`);
    const body = (await res.json()) as { ok: true; workspaceId: string; tabId: string };
    expect(body.tabId).toBe(tempTabId);
    expect(body.workspaceId).toBe(wm.getActiveWorkspaceId(created.windowId));
  });
});
