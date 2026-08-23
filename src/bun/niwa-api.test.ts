import { describe, expect, test } from "bun:test";
import { isCustomBindingRef, type KeybindingsConfig, type ShellProfile } from "@niwaterm/config";
import { listLeaves, type TileLeaf, type TileNode } from "./tile-layout";
import { createNiwaApi } from "./niwa-api";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import {
  createWorkspaceManager,
  type WorkspaceManager,
  type WorkspaceManagerOptions,
} from "./workspace-manager";

/**
 * PTY起動はwebview側の実測cols/rowsが届く（handleResize）まで保留される設計（TASK-0047）。
 * テストではcreateWorkspaceManager直後にこれを呼び、pending中の全タブへダミーのcols/rowsを
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

/** テスト内でniwa.keybindに渡した関数ハンドラのidを取り出す */
function customHandlerId(config: KeybindingsConfig, key: string): string {
  const target = config.bindings?.[key];
  if (!isCustomBindingRef(target)) {
    throw new Error(`expected a custom BindingTarget for key "${key}", got: ${String(target)}`);
  }
  return target.id;
}

function createFakeSessionFactory() {
  const factory = (_opts: TerminalSessionOptions): TerminalSession => ({
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
      cursorShape: "block",
      viewportPinned: true,
    }),
    dumpText: () => "",
    setCallbacks: () => {},
    dispose: () => {},
  });
  return factory;
}

function createTestSetup(
  overrides: Partial<WorkspaceManagerOptions> = {},
  getShellProfiles: () => ShellProfile[] = () => [],
  depsOverrides: Partial<
    Pick<Parameters<typeof createNiwaApi>[0], "sendNotification" | "reloadConfig">
  > = {},
) {
  const workspaceManager = createWorkspaceManager({
    initialCols: 80,
    initialRows: 24,
    onDirty: () => {},
    onAllWorkspacesClosed: () => {},
    createSession: createFakeSessionFactory(),
    ...overrides,
  });
  const api = createNiwaApi({
    workspaceManager,
    getShellProfiles,
    getShellRunEnv: () => ({}),
    getDefaultShell: () => "bash",
    sendNotification: () => {},
    reloadConfig: async () => {},
    ...depsOverrides,
  });
  return { workspaceManager, ...api };
}

describe("niwa.keybind / niwa.prefix / niwa.unbind（登録フェーズ）", () => {
  test("文字列アクションはBindingTargetとしてそのまま登録される", () => {
    const { niwa, extractKeybindingsConfig } = createTestSetup();
    niwa.keybind("d", "split-horizontal");
    expect(extractKeybindingsConfig().bindings?.["d"]).toBe("split-horizontal");
  });

  test("関数ハンドラはkind:customのBindingTargetに変換され、一意なidが振られる", () => {
    const { niwa, extractKeybindingsConfig } = createTestSetup();
    niwa.keybind("d", () => {});
    niwa.keybind("w", () => {});
    const config = extractKeybindingsConfig();
    const d = config.bindings?.["d"];
    const w = config.bindings?.["w"];
    expect(d).toMatchObject({ kind: "custom" });
    expect(w).toMatchObject({ kind: "custom" });
    expect((d as { id: string }).id).not.toBe((w as { id: string }).id);
  });

  test("noPrefix:trueはdirectテーブルに登録される", () => {
    const { niwa, extractKeybindingsConfig } = createTestSetup();
    niwa.keybind("cmd+shift+c", "copy-selection", { noPrefix: true });
    const config = extractKeybindingsConfig();
    expect(config.bindings?.["cmd+shift+c"]).toBeUndefined();
    expect(config.direct?.["cmd+shift+c"]).toBe("copy-selection");
  });

  test("同じkeyへの再登録は後勝ちで上書きされる", () => {
    const { niwa, extractKeybindingsConfig } = createTestSetup();
    niwa.keybind("d", "split-horizontal");
    niwa.keybind("d", "close-tile");
    expect(extractKeybindingsConfig().bindings?.["d"]).toBe("close-tile");
  });

  test("unbindで登録済みのバインドを消せる", () => {
    const { niwa, extractKeybindingsConfig } = createTestSetup();
    niwa.keybind("d", "split-horizontal");
    niwa.unbind("d");
    expect(extractKeybindingsConfig().bindings?.["d"]).toBeUndefined();
  });

  test("niwa.prefixで指定したprefixが反映される", () => {
    const { niwa, extractKeybindingsConfig } = createTestSetup();
    niwa.prefix("cmd+j");
    expect(extractKeybindingsConfig().prefix).toBe("cmd+j");
  });

  test("repeat:trueを付けたバインドは{target, repeat:true}として登録される", () => {
    const { niwa, extractKeybindingsConfig } = createTestSetup();
    niwa.keybind("h", "resize-left", { repeat: true });
    expect(extractKeybindingsConfig().bindings?.["h"]).toEqual({
      target: "resize-left",
      repeat: true,
    });
  });

  test("repeat未指定はプレーンなBindingTargetのまま登録される", () => {
    const { niwa, extractKeybindingsConfig } = createTestSetup();
    niwa.keybind("d", "split-horizontal");
    expect(extractKeybindingsConfig().bindings?.["d"]).toBe("split-horizontal");
  });

  test("niwa.repeatTimeoutで指定した値が反映される", () => {
    const { niwa, extractKeybindingsConfig } = createTestSetup();
    niwa.repeatTimeout(300);
    expect(extractKeybindingsConfig().repeatTimeoutMs).toBe(300);
  });

  test("niwa.repeatTimeout未呼び出しはundefinedのまま（呼び出し側でデフォルト解決する）", () => {
    const { extractKeybindingsConfig } = createTestSetup();
    expect(extractKeybindingsConfig().repeatTimeoutMs).toBeUndefined();
  });
});

describe("runHandler（RPC経由でのcustomハンドラ実行）", () => {
  test("登録した関数ハンドラがniwaを引数に呼ばれる", async () => {
    const { niwa, extractKeybindingsConfig, runHandler } = createTestSetup();
    let receivedNiwa: unknown;
    niwa.keybind("d", (n) => {
      receivedNiwa = n;
    });
    const id = customHandlerId(extractKeybindingsConfig(), "d");
    await runHandler(id);
    expect(receivedNiwa).toBe(niwa);
  });

  test("非同期ハンドラの完了を待てる", async () => {
    const { niwa, extractKeybindingsConfig, runHandler } = createTestSetup();
    let done = false;
    niwa.keybind("d", async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      done = true;
    });
    const id = customHandlerId(extractKeybindingsConfig(), "d");
    await runHandler(id);
    expect(done).toBe(true);
  });

  test("未知のidは黙って何もしない", async () => {
    const { runHandler } = createTestSetup();
    await expect(runHandler("no-such-handler")).resolves.toBeUndefined();
  });
});

describe("niwa.tile", () => {
  test("current()はフォーカス中タイルのidを返す", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tileId = (workspaceManager.snapshot().workspace.board.layout as TileLeaf).id;
    expect(niwa.tile.current()?.id).toBe(tileId);
  });

  test("split()はworkspaceManager.splitTileへ委譲し、新しいtileId/tabIdを返す", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const before = (workspaceManager.snapshot().workspace.board.layout as TileLeaf).id;
    const result = niwa.tile.split({ orientation: "vertical" });
    expect(result).not.toBeNull();
    expect(result?.tileId).not.toBe(before);
  });

  test("close()はフォーカス中タイルのアクティブタブを閉じる", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tileId = (workspaceManager.snapshot().workspace.board.layout as TileLeaf).id;
    niwa.tile.split({ orientation: "vertical" });
    workspaceManager.focusTile(tileId);
    niwa.tile.close();
    // 元のタイルは1タブしかなかったため、閉じるとタイル自体が消える（残り1タイルへ畳まれる）
    expect(workspaceManager.snapshot().workspace.board.layout.kind).toBe("leaf");
  });

  test("resize()はフォーカス中タイルをdirection方向へ拡大し、trueを返す", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tileId = (workspaceManager.snapshot().workspace.board.layout as TileLeaf).id;
    niwa.tile.split({ orientation: "vertical" }); // row split, ratio 0.5
    workspaceManager.focusTile(tileId);
    expect(niwa.tile.resize({ direction: "right", amount: 0.1 })).toBe(true);
    const tree = workspaceManager.snapshot().workspace.board.layout as TileNode & { kind: "split" };
    expect(tree.ratio).toBeCloseTo(0.6);
  });

  test("resize()は軸が一致する祖先splitが無い場合はfalse", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tileId = (workspaceManager.snapshot().workspace.board.layout as TileLeaf).id;
    niwa.tile.split({ orientation: "vertical" }); // rowのみ、column方向は無い
    workspaceManager.focusTile(tileId);
    expect(niwa.tile.resize({ direction: "up" })).toBe(false);
  });

  test("zoom()はフォーカス中タイルのズームを切り替え、トグル後の状態を返す", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tileId = (workspaceManager.snapshot().workspace.board.layout as TileLeaf).id;
    expect(niwa.tile.zoom()).toBe(true);
    expect(workspaceManager.snapshot().workspace.board.zoomedTileId).toBe(tileId);
    expect(niwa.tile.zoom()).toBe(false);
    expect(workspaceManager.snapshot().workspace.board.zoomedTileId).toBeNull();
  });
});

describe("niwa.tab", () => {
  test("current()はフォーカス中タイルのアクティブタブのtabIdを返す", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tabId = (workspaceManager.snapshot().workspace.board.layout as TileLeaf)
      .tabIds[0] as string;
    expect(niwa.tab.current()?.tabId).toBe(tabId);
  });

  test("createはフォーカス中タイルへ新規タブを作る", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const result = niwa.tab.create();
    expect(result).not.toBeNull();
    expect(workspaceManager.hasTab(result?.tabId ?? "")).toBe(true);
  });

  test("var.set/getでタブ変数を読み書きできる", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tabId = (workspaceManager.snapshot().workspace.board.layout as TileLeaf)
      .tabIds[0] as string;
    expect(niwa.tab.var.get(tabId, "role")).toBeUndefined();
    niwa.tab.var.set(tabId, "role", "editor");
    expect(niwa.tab.var.get(tabId, "role")).toBe("editor");
  });

  test("var.findは全ワークスペース・タイルを横断して一致するtabIdを返す", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tabA = (workspaceManager.snapshot().workspace.board.layout as TileLeaf)
      .tabIds[0] as string;
    const tabB = niwa.tab.create()?.tabId as string;
    niwa.workspace.create();
    const tabC = niwa.tab.current()?.tabId as string;

    niwa.tab.var.set(tabA, "role", "editor");
    niwa.tab.var.set(tabB, "role", "shell");
    niwa.tab.var.set(tabC, "role", "editor");

    expect(niwa.tab.var.find("role", "editor").sort()).toEqual([tabA, tabC].sort());
    expect(niwa.tab.var.find("role", "no-such-value")).toEqual([]);
  });

  test("showは所属ワークスペースへの切替・タイルフォーカス・タブアクティブ化をまとめて行う", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const firstWorkspaceId = niwa.workspace.current();
    const firstTileId = (workspaceManager.snapshot().workspace.board.layout as TileLeaf).id;
    const targetTabId = niwa.tab.create()?.tabId as string;
    niwa.workspace.create(); // 以後、firstWorkspaceIdは非アクティブ

    expect(niwa.tab.show(targetTabId)).toBe(true);
    expect(niwa.workspace.current()).toBe(firstWorkspaceId);
    expect(workspaceManager.getActiveTabId(firstTileId)).toBe(targetTabId);
  });

  test("showは存在しないtabIdならfalse", () => {
    const { niwa } = createTestSetup();
    expect(niwa.tab.show("no-such-tab")).toBe(false);
  });

  test("respawnは既存タブを再起動し、trueを返す", () => {
    const { niwa, workspaceManager } = createTestSetup();
    resolvePending(workspaceManager);
    const tabId = (workspaceManager.snapshot().workspace.board.layout as TileLeaf)
      .tabIds[0] as string;
    expect(niwa.tab.respawn(tabId)).toBe(true);
    expect(workspaceManager.hasTab(tabId)).toBe(true);
  });

  test("respawnは未知のshellProfileならfalseを返す", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tabId = (workspaceManager.snapshot().workspace.board.layout as TileLeaf)
      .tabIds[0] as string;
    expect(niwa.tab.respawn(tabId, { shellProfile: "no-such-profile" })).toBe(false);
  });

  test("respawnは存在しないtabIdならfalse", () => {
    const { niwa } = createTestSetup();
    expect(niwa.tab.respawn("no-such-tab")).toBe(false);
  });
});

describe("niwa.workspace", () => {
  test("createで新しいワークスペースが増える", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const before = workspaceManager.snapshot().workspaceIds.length;
    niwa.workspace.create();
    expect(workspaceManager.snapshot().workspaceIds.length).toBe(before + 1);
  });

  test("switchで存在しないidを渡すとfalse", () => {
    const { niwa } = createTestSetup();
    expect(niwa.workspace.switch("no-such-workspace")).toBe(false);
  });

  test("swapで2つのworkspaceの表示順を入れ替え、trueを返す", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const firstId = workspaceManager.snapshot().activeWorkspaceId;
    const secondId = niwa.workspace.create();
    expect(niwa.workspace.swap(firstId, secondId)).toBe(true);
    expect(workspaceManager.snapshot().workspaceIds).toEqual([secondId, firstId]);
  });

  test("swapで存在しないidを渡すとfalse", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const onlyId = workspaceManager.snapshot().activeWorkspaceId;
    expect(niwa.workspace.swap(onlyId, "no-such-workspace")).toBe(false);
  });

  test("listは表示順で全ワークスペースのid/name/activeを返す", () => {
    const { niwa } = createTestSetup();
    const firstId = niwa.workspace.current();
    const secondId = niwa.workspace.create();
    expect(niwa.workspace.list()).toEqual([
      { id: firstId, name: null, active: false },
      { id: secondId, name: null, active: true },
    ]);
  });

  test("currentはアクティブなworkspaceIdを返し、switch後は切り替わる", () => {
    const { niwa } = createTestSetup();
    const firstId = niwa.workspace.current();
    const secondId = niwa.workspace.create();
    expect(niwa.workspace.current()).toBe(secondId);
    niwa.workspace.switch(firstId);
    expect(niwa.workspace.current()).toBe(firstId);
  });
});

describe("niwa.shell.run", () => {
  test("コマンドを実行して結果を返す", async () => {
    const { niwa } = createTestSetup({}, () => [
      { id: "test-shell", name: "test", command: "bash" },
    ]);
    const result = await niwa.shell.run("echo hi", { shellProfile: "test-shell" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hi");
  });

  test("shellProfile省略時はgetDefaultShell()（shell.default設定）にフォールバックする", async () => {
    const { niwa } = createTestSetup();
    const result = await niwa.shell.run("echo hi");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hi");
  });

  test("未知のshellProfileならexitCode 1とエラーメッセージを返す", async () => {
    const { niwa } = createTestSetup();
    const result = await niwa.shell.run("echo hi", { shellProfile: "no-such-profile" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown shellProfileId");
  });
});

describe("niwa.sleep", () => {
  test("指定ms後にresolveする", async () => {
    const { niwa } = createTestSetup();
    const start = Date.now();
    await niwa.sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });
});

describe("niwa.notify", () => {
  test("渡したoptsのままsendNotificationへ委譲する", () => {
    const received: unknown[] = [];
    const { niwa } = createTestSetup({}, undefined, {
      sendNotification: (opts) => received.push(opts),
    });
    niwa.notify({ title: "t", body: "b" });
    expect(received).toEqual([{ title: "t", body: "b" }]);
  });
});

describe("niwa.reloadConfig", () => {
  test("reloadConfigの完了を待ってから後続処理へ進める", async () => {
    const calls: string[] = [];
    const { niwa } = createTestSetup({}, undefined, {
      reloadConfig: async () => {
        calls.push("reload");
      },
      sendNotification: () => calls.push("notify"),
    });
    await niwa.reloadConfig();
    niwa.notify({ title: "done" });
    expect(calls).toEqual(["reload", "notify"]);
  });
});
