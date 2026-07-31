import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIpcServer, type IpcServer } from "./ipc-server";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import type { TileLeaf } from "./tile-layout";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

function createTestWorkspaceManager(): {
  mgr: WorkspaceManager;
  writes: (string | Uint8Array)[][];
} {
  const writes: (string | Uint8Array)[][] = [];
  const createSession = (_opts: TerminalSessionOptions): TerminalSession => {
    const record: (string | Uint8Array)[] = [];
    writes.push(record);
    return {
      write: (data) => record.push(data),
      paste: () => {},
      resize: () => false,
      renderState: () => ({ html: "", cursorX: 0, cursorY: 0, cursorVisible: true }),
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
  return { mgr, writes };
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
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    mgr.splitTile(firstTileId, "vertical");
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/list", { unix: socketPath });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspaces: unknown[] };
    expect(body.workspaces.length).toBe(1);
    expect(body.workspaces[0]).toMatchObject({
      workspaceId: mgr.snapshot().activeWorkspaceId,
      active: true,
      layout: mgr.snapshot().workspace.layout,
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
    const tabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
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
    const tabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
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
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
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
    expect(mgr.snapshot().workspace.layout.kind).toBe("split");
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
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    server = await createIpcServer(socketPath, mgr);

    const res = await fetch("http://localhost/split-tile", {
      unix: socketPath,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileId, orientation: "diagonal" }),
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
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
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
    expect((mgr.snapshot().workspace.layout as TileLeaf).tabIds).toContain(body.tabId);
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
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
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
    expect((mgr.snapshot().workspace.layout as TileLeaf).activeTabId).toBe(firstTabId);
  });

  test("存在しないtileId/tabIdは404を返す", async () => {
    const { mgr } = createTestWorkspaceManager();
    const tabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
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
    const tileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
    const firstTabId = (mgr.snapshot().workspace.layout as TileLeaf).activeTabId;
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
    const leaf = mgr.snapshot().workspace.layout as TileLeaf;
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
    const firstTileId = (mgr.snapshot().workspace.layout as TileLeaf).id;
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
    expect(mgr.snapshot().workspace.focusedTileId).toBe(firstTileId);
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
