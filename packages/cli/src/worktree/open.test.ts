import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcEndpoint } from "../ipc-client";
import { openWorktree, resolveWorktreeLayout } from "./open";

/** failAndExitのprocess.exitを例外へ差し替えて、終了したことをテストから観測する */
function expectExit(fn: () => void): void {
  const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(fn).toThrow("exit:1");
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

describe("resolveWorktreeLayout", () => {
  test("--layoutは設定の既定値より優先される", () => {
    expect(
      resolveWorktreeLayout({
        commandName: "worktree open",
        explicit: "from-flag",
        configured: "from-config",
        trust: "trusted",
      }),
    ).toBe("from-flag");
  });

  test("--layout省略時は設定の既定値を使う", () => {
    expect(
      resolveWorktreeLayout({
        commandName: "worktree open",
        explicit: undefined,
        configured: "from-config",
        trust: "absent",
      }),
    ).toBe("from-config");
  });

  test("どちらも無ければundefined（未承認でも止めない）", () => {
    expect(
      resolveWorktreeLayout({
        commandName: "worktree open",
        explicit: undefined,
        configured: undefined,
        trust: "declined",
      }),
    ).toBeUndefined();
  });

  test("未承認のリポジトリでレイアウトを指定されたら終了する", () => {
    expectExit(() =>
      resolveWorktreeLayout({
        commandName: "worktree open",
        explicit: "from-flag",
        configured: undefined,
        trust: "declined",
      }),
    );
  });
});

/** openWorktreeが叩くIPCを受け、受け取ったボディを記録する偽サーバー */
async function startFakeApp(applyLayoutResponses: unknown[] = []): Promise<{
  endpoint: IpcEndpoint;
  requests: { path: string; body: unknown }[];
  stop: () => void;
}> {
  const dir = await mkdtemp(join(tmpdir(), "niwaterm-worktree-open-"));
  const socketPath = join(dir, "niwaterm.sock");
  const requests: { path: string; body: unknown }[] = [];
  let applyCalls = 0;
  const server = Bun.serve({
    unix: socketPath,
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      requests.push({ path, body: req.method === "POST" ? await req.json() : null });
      if (path === "/list") return Response.json({ workspaces: [] });
      if (path === "/new-board") return Response.json({ ok: true, boardId: "board-9" });
      if (path === "/apply-layout") {
        return Response.json(
          applyLayoutResponses[applyCalls++] ?? { ok: true, boardId: "board-9" },
        );
      }
      return Response.json({ ok: false, error: `unexpected ${path}` }, { status: 404 });
    },
  });
  return {
    endpoint: { kind: "unix", path: socketPath },
    requests,
    stop: () => {
      server.stop(true);
    },
  };
}

describe("openWorktree", () => {
  test("--layoutで適用したプリセットを起動時レイアウトとしても紐づける", async () => {
    const app = await startFakeApp();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await openWorktree({
        endpoint: app.endpoint,
        commandName: "worktree open",
        mode: "board",
        repoRoot: "/repo/main",
        path: "/repo/work/feature",
        branch: "feature",
        layout: { explicit: "dev", resolve: async () => ({ preset: "dev", trusted: true }) },
      });
    } finally {
      logSpy.mockRestore();
      app.stop();
    }

    expect(app.requests.find((r) => r.path === "/apply-layout")?.body).toEqual({
      name: "dev",
      target: "replace",
      boardId: "board-9",
      cwd: "/repo/main",
      tabCwd: "/repo/work/feature",
      startup: true,
      trust: true,
    });
  });

  test("プリセットが無ければレイアウトは適用しない", async () => {
    const app = await startFakeApp();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await openWorktree({
        endpoint: app.endpoint,
        commandName: "worktree open",
        mode: "board",
        repoRoot: "/repo/main",
        path: "/repo/work/feature",
        branch: "feature",
        layout: { resolve: async () => ({ trusted: false }) },
      });
    } finally {
      logSpy.mockRestore();
      app.stop();
    }

    expect(app.requests.some((r) => r.path === "/apply-layout")).toBe(false);
  });
});
