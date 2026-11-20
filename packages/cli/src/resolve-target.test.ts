import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcEndpoint } from "./ipc-client";
import { createTargetResolver } from "./resolve-target";

const FAKE_TARGET = {
  workspaceId: "workspace-0",
  boardId: "board-1",
  tileId: "tile-2",
  tabId: "tab-3",
};

describe("createTargetResolver", () => {
  let dir: string;
  let socketPath: string;
  let endpoint: IpcEndpoint;
  let server: ReturnType<typeof Bun.serve> | null;
  /** サーバーが受け取った?tabId=の値。未指定はnullが積まれる */
  let receivedTabIds: (string | null)[];
  const originalEnvTabId = process.env["NIWATERM_TAB_ID"];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-resolve-target-test-"));
    socketPath = join(dir, "niwaterm.sock");
    endpoint = { kind: "unix", path: socketPath };
    receivedTabIds = [];
    server = Bun.serve({
      unix: socketPath,
      fetch: (req) => {
        receivedTabIds.push(new URL(req.url).searchParams.get("tabId"));
        return Response.json({ ok: true, ...FAKE_TARGET });
      },
    });
    delete process.env["NIWATERM_TAB_ID"];
  });

  afterEach(async () => {
    await server?.stop(true);
    if (originalEnvTabId === undefined) delete process.env["NIWATERM_TAB_ID"];
    else process.env["NIWATERM_TAB_ID"] = originalEnvTabId;
    await rm(dir, { recursive: true, force: true });
  });

  test("省略された項目だけniwatermの解決結果で埋める", async () => {
    const resolver = createTargetResolver(endpoint, "tab close", {});
    expect(await resolver.tileId()).toBe(FAKE_TARGET.tileId);
    expect(await resolver.tabId()).toBe(FAKE_TARGET.tabId);
    expect(await resolver.boardId()).toBe(FAKE_TARGET.boardId);
    expect(await resolver.workspaceId()).toBe(FAKE_TARGET.workspaceId);
  });

  test("明示指定された値は解決結果で上書きしない", async () => {
    const resolver = createTargetResolver(endpoint, "tab close", {
      tileId: "tile-explicit",
      tabId: "tab-explicit",
    });
    expect(await resolver.tileId()).toBe("tile-explicit");
    expect(await resolver.tabId()).toBe("tab-explicit");
  });

  test("読んだ項目が全て明示済みなら問い合わせない", async () => {
    const resolver = createTargetResolver(endpoint, "tile zoom", { tileId: "tile-explicit" });
    expect(await resolver.tileId()).toBe("tile-explicit");
    expect(receivedTabIds).toEqual([]);
  });

  test("複数の項目を解決しても問い合わせは1回だけ", async () => {
    const resolver = createTargetResolver(endpoint, "tab close", {});
    await resolver.tileId();
    await resolver.tabId();
    await resolver.boardId();
    expect(receivedTabIds.length).toBe(1);
  });

  test("起点は明示指定の--tab、無ければNIWATERM_TAB_ID", async () => {
    process.env["NIWATERM_TAB_ID"] = "tab-env";

    const explicit = createTargetResolver(endpoint, "tab close", { tabId: "tab-explicit" });
    await explicit.tileId();
    expect(receivedTabIds).toEqual(["tab-explicit"]);

    const fromEnv = createTargetResolver(endpoint, "tab close", {});
    await fromEnv.tileId();
    expect(receivedTabIds).toEqual(["tab-explicit", "tab-env"]);
  });
});
