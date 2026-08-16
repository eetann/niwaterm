import { describe, expect, test } from "bun:test";
import type { KeybindingsConfig } from "@niwaterm/config";
import type { TileLeaf } from "./tile-layout";
import { createNiwaApi } from "./niwa-api";
import type { TerminalSession, TerminalSessionOptions } from "./terminal-session";
import { createWorkspaceManager, type WorkspaceManagerOptions } from "./workspace-manager";

/** テスト内でniwa.keybindに渡した関数ハンドラのidを取り出す */
function customHandlerId(config: KeybindingsConfig, key: string): string {
  const target = config.bindings?.[key];
  if (typeof target !== "object" || target === null || target.kind !== "custom") {
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
      viewportPinned: true,
    }),
    dumpText: () => "",
    dispose: () => {},
  });
  return factory;
}

function createTestSetup(overrides: Partial<WorkspaceManagerOptions> = {}) {
  const workspaceManager = createWorkspaceManager({
    initialCols: 80,
    initialRows: 24,
    onDirty: () => {},
    onAllWorkspacesClosed: () => {},
    createSession: createFakeSessionFactory(),
    ...overrides,
  });
  const api = createNiwaApi({ workspaceManager, getShellProfiles: () => [] });
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
    const tileId = (workspaceManager.snapshot().workspace.layout as TileLeaf).id;
    expect(niwa.tile.current()?.id).toBe(tileId);
  });

  test("split()はworkspaceManager.splitTileへ委譲し、新しいtileId/tabIdを返す", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const before = (workspaceManager.snapshot().workspace.layout as TileLeaf).id;
    const result = niwa.tile.split({ orientation: "vertical" });
    expect(result).not.toBeNull();
    expect(result?.tileId).not.toBe(before);
  });

  test("close()はフォーカス中タイルのアクティブタブを閉じる", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tileId = (workspaceManager.snapshot().workspace.layout as TileLeaf).id;
    niwa.tile.split({ orientation: "vertical" });
    workspaceManager.focusTile(tileId);
    niwa.tile.close();
    // 元のタイルは1タブしかなかったため、閉じるとタイル自体が消える（残り1タイルへ畳まれる）
    expect(workspaceManager.snapshot().workspace.layout.kind).toBe("leaf");
  });
});

describe("niwa.tab", () => {
  test("createはフォーカス中タイルへ新規タブを作る", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const result = niwa.tab.create();
    expect(result).not.toBeNull();
    expect(workspaceManager.hasTab(result?.tabId ?? "")).toBe(true);
  });

  test("var.set/getでタブ変数を読み書きできる", () => {
    const { niwa, workspaceManager } = createTestSetup();
    const tabId = (workspaceManager.snapshot().workspace.layout as TileLeaf).tabIds[0] as string;
    expect(niwa.tab.var.get(tabId, "role")).toBeUndefined();
    niwa.tab.var.set(tabId, "role", "editor");
    expect(niwa.tab.var.get(tabId, "role")).toBe("editor");
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
});

describe("niwa.sleep", () => {
  test("指定ms後にresolveする", async () => {
    const { niwa } = createTestSetup();
    const start = Date.now();
    await niwa.sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });
});
