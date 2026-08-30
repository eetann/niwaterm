import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LayoutsConfig } from "@niwaterm/config";
import type { BrowserBridge } from "./browser-bridge";
import type { ScreenshotResult } from "./browser-screenshot";
import { createIpcServer, type IpcServer } from "./ipc-server";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import { listLeaves, type TileLeaf, type TileSplit } from "./tile-layout";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

/**
 * PTY起動はwebview側の実測cols/rowsが届く（handleResize）まで保留される設計（TASK-0047）。
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
  // 初期タブのPTY起動はwebview側の実測cols/rowsが届くまで保留される（TASK-0047）。
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
    server = await createIpcServer(socketPath, mgr, () => ({
      name: "Notes",
      url: "file:///tmp/notes.html",
    }));

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

  test("urlとcustomViewを同時に指定すると400を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileId = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr, () => ({
      name: "Notes",
      url: "file:///tmp/notes.html",
    }));

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
      () => null,
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
      () => null,
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
    server = await createIpcServer(socketPath, mgr, () => ({
      name: "Notes",
      url: "file:///tmp/notes.html",
    }));

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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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
      () => null,
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

  test("find-vars: scopeTabIdを指定すると同じワークスペース内のみ検索する", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tileA = (mgr.snapshot().workspace.board.layout as TileLeaf).id;
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    const splitResult = mgr.splitTile(tileA, "vertical");
    const tabB = splitResult?.tabId as string;
    mgr.newWorkspace();
    const tabC = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
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
      body: JSON.stringify({ tabId: tabC, key: "role", value: "claude" }),
    });

    // tabB（tabAと同じワークスペース）を起点にすると、別ワークスペースのtabCは見つからない
    const res = await fetch(`http://localhost/find-vars?key=role&value=claude&scopeTabId=${tabB}`, {
      unix: socketPath,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tabIds: [tabA] });
  });

  test("find-vars: scopeTabId未指定は全ワークスペースを横断して検索する", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tabA = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
    mgr.newWorkspace();
    const tabC = (mgr.snapshot().workspace.board.layout as TileLeaf).activeTabId;
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
      body: JSON.stringify({ tabId: tabC, key: "role", value: "claude" }),
    });

    const res = await fetch("http://localhost/find-vars?key=role&value=claude", {
      unix: socketPath,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { tabIds: string[] }).toEqual({
      ok: true,
      tabIds: expect.arrayContaining([tabA, tabC]),
    });
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
        () => null,
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

  test("GET /layouts: 設定済みプリセットをname/descriptionの一覧として返す", async () => {
    const { serverPromise } = createServerWithLayouts(LAYOUTS);
    server = await serverPromise;

    const res = await fetch("http://localhost/layouts", { unix: socketPath });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; layouts: unknown[] };
    expect(body.layouts).toEqual([
      { name: "dev", description: "Editor + terminal" },
      { name: "broken", description: undefined },
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
    // 起動する（TASK-0045）。実際のwebviewの代わりにここで送ってやる
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
    // 起動する（TASK-0045）。実際のwebviewの代わりにここで送ってやる
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
