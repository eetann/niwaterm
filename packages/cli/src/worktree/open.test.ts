import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
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
async function startFakeApp(
  applyLayoutResponses: unknown[] = [],
  workspaces: unknown[] = [],
): Promise<{
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
      if (path === "/list") return Response.json({ workspaces });
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
      void server.stop(true);
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
        created: false,
        boardSetup: {
          explicitLayout: "dev",
          resolve: async () => ({ preset: "dev", trusted: true, onOpen: [] }),
        },
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
        created: false,
        boardSetup: { resolve: async () => ({ trusted: false, onOpen: [] }) },
      });
    } finally {
      logSpy.mockRestore();
      app.stop();
    }

    expect(app.requests.some((r) => r.path === "/apply-layout")).toBe(false);
  });
});

/** new-boardで作られたBoard（board-9）が、レイアウト適用後に2タイル3タブになっている一覧 */
const CREATED_BOARD_WORKSPACES = [
  {
    workspaceId: "ws-1",
    active: true,
    activeBoardId: "board-9",
    name: null,
    boards: [
      {
        boardId: "board-9",
        active: true,
        focusedTileId: "tile-1",
        layout: {
          kind: "split",
          id: "split-1",
          direction: "row",
          ratio: 0.5,
          first: { kind: "leaf", id: "tile-1", tabIds: ["tab-1", "tab-2"], activeTabId: "tab-1" },
          second: { kind: "leaf", id: "tile-2", tabIds: ["tab-3"], activeTabId: "tab-3" },
        },
        tabNames: {},
        name: "feature",
        autoName: "feature (auto)",
        startup: null,
        // findOpenBoardに既存Boardと見なされないよう、紐づけ無しにしておく
        worktreePath: null,
        worktreeMissing: false,
        phase: null,
      },
    ],
  },
];

describe("openWorktreeのonOpenフック", () => {
  test("Boardを新規に作ったら、タブを含むctxでフックを順に呼ぶ", async () => {
    const app = await startFakeApp([], CREATED_BOARD_WORKSPACES);
    const worktreePath = await realpath(await mkdtemp(join(tmpdir(), "niwaterm-worktree-hook-")));
    const originalCwd = process.cwd();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const calls: unknown[] = [];
    try {
      await openWorktree({
        endpoint: app.endpoint,
        commandName: "worktree new",
        mode: "board",
        repoRoot: "/repo/main",
        path: worktreePath,
        branch: "feature",
        created: true,
        boardSetup: {
          resolve: async () => ({
            trusted: false,
            onOpen: [
              (ctx) => {
                calls.push({ hook: 1, ...ctx });
              },
              async (ctx) => {
                calls.push({ hook: 2, boardId: ctx.boardId, cwd: process.cwd() });
              },
            ],
          }),
        },
      });
    } finally {
      logSpy.mockRestore();
      app.stop();
    }

    expect(process.cwd()).toBe(originalCwd);
    expect(calls).toEqual([
      {
        hook: 1,
        repoRoot: "/repo/main",
        worktreePath,
        branch: "feature",
        created: true,
        workspaceId: "ws-1",
        boardId: "board-9",
        boardName: "feature",
        boardAutoName: "feature (auto)",
        tabIds: ["tab-1", "tab-2", "tab-3"],
      },
      { hook: 2, boardId: "board-9", cwd: worktreePath },
    ]);
  });

  test("既に開いているBoardを使い回すときはフックを呼ばない", async () => {
    const app = await startFakeApp(
      [],
      [
        {
          ...CREATED_BOARD_WORKSPACES[0],
          boards: [
            { ...CREATED_BOARD_WORKSPACES[0]?.boards[0], worktreePath: "/repo/work/feature" },
          ],
        },
      ],
    );
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let resolved = false;
    try {
      await openWorktree({
        endpoint: app.endpoint,
        commandName: "worktree open",
        mode: "board",
        repoRoot: "/repo/main",
        path: "/repo/work/feature",
        branch: "feature",
        created: false,
        boardSetup: {
          resolve: async () => {
            resolved = true;
            return { trusted: false, onOpen: [] };
          },
        },
      });
    } finally {
      logSpy.mockRestore();
      app.stop();
    }

    expect(resolved).toBe(false);
    expect(app.requests.some((r) => r.path === "/new-board")).toBe(false);
  });

  test("フックが失敗したらBoardは閉じずに終了する", async () => {
    const app = await startFakeApp([], CREATED_BOARD_WORKSPACES);
    const worktreePath = await mkdtemp(join(tmpdir(), "niwaterm-worktree-hook-"));
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    try {
      await expect(
        openWorktree({
          endpoint: app.endpoint,
          commandName: "worktree new",
          mode: "board",
          repoRoot: "/repo/main",
          path: worktreePath,
          branch: "feature",
          created: true,
          boardSetup: {
            resolve: async () => ({
              trusted: false,
              onOpen: [
                () => {
                  throw new Error("boom");
                },
              ],
            }),
          },
        }),
      ).rejects.toThrow("exit:1");
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain("Board board-9 は作成済みです");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
      app.stop();
    }

    expect(app.requests.some((r) => r.path === "/close-board")).toBe(false);
  });
});
