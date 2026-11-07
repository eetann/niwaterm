import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LayoutsConfig } from "@niwaterm/config";
import {
  applyAndBindStartupLayout,
  changeBoardStartup,
  type BoardStartupStore,
} from "./board-startup";
import type { PersistedBoardStartup } from "./persistence";
import type { TerminalSession } from "./terminal-session";
import type { TileLeaf } from "./tile-layout";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const LAYOUTS: LayoutsConfig = {
  dev: { layout: { kind: "tile", tabs: [{}] } },
  work: { layout: { kind: "tile", tabs: [{}] } },
};

/** applyAndBindStartupLayoutが実際に組み立てた結果を確かめるため、タブ名の付いたプリセットを使う */
const NAMED_LAYOUTS: LayoutsConfig = {
  named: { layout: { kind: "tile", tabs: [{ name: "editor" }] } },
};

function createStore(initial: Record<string, PersistedBoardStartup> = {}): BoardStartupStore & {
  startups: Map<string, PersistedBoardStartup>;
} {
  const startups = new Map(Object.entries(initial));
  return {
    startups,
    hasBoard: (boardId) => boardId === "board-1" || startups.has(boardId),
    getBoardStartup: (boardId) => startups.get(boardId) ?? null,
    setBoardStartup: (boardId, startup) => {
      if (startup === null) startups.delete(boardId);
      else startups.set(boardId, startup);
      return true;
    },
  };
}

/** .niwaterm/config.tsを持つ一時ディレクトリを作り、そのルートを返す */
async function createProjectRoot(presetName: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niwaterm-board-startup-"));
  await mkdir(join(root, ".niwaterm"), { recursive: true });
  await writeFile(
    join(root, ".niwaterm", "config.ts"),
    `export default { layouts: { ${presetName}: { layout: { kind: "tile", tabs: [{}] } } } };\n`,
  );
  return root;
}

describe("changeBoardStartup", () => {
  test("presetを指定してmode:layoutへ紐づける", async () => {
    const store = createStore();

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "layout",
      preset: "dev",
    });

    expect(result).toEqual({
      ok: true,
      boardId: "board-1",
      startup: { preset: "dev", restoreMode: "layout" },
    });
    expect(store.startups.get("board-1")).toEqual({ preset: "dev", restoreMode: "layout" });
  });

  test("preset省略時は既に紐づいているプリセットを引き継ぐ", async () => {
    const store = createStore({ "board-1": { preset: "dev", restoreMode: "layout" } });

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "restore",
    });

    expect(result).toEqual({
      ok: true,
      boardId: "board-1",
      startup: { preset: "dev", restoreMode: "restore" },
    });
  });

  test("グローバル設定由来のpresetは実行ディレクトリも記録する（起動時のタブのcwdの基準になる）", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "niwaterm-startup-cwd-"));
    const store = createStore();

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "layout",
      preset: "dev",
      cwd,
    });

    expect(result).toEqual({
      ok: true,
      boardId: "board-1",
      startup: { preset: "dev", restoreMode: "layout", cwd },
    });
  });

  test("preset省略時はcwdも引き継ぐ（別ディレクトリからmodeだけ切り替えても基準が動かない）", async () => {
    const store = createStore({
      "board-1": { preset: "dev", restoreMode: "layout", cwd: "/home/me/dotfiles" },
    });

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "restore",
      cwd: tmpdir(),
    });

    expect(result).toEqual({
      ok: true,
      boardId: "board-1",
      startup: { preset: "dev", restoreMode: "restore", cwd: "/home/me/dotfiles" },
    });
  });

  test("preset省略時はtabCwdも引き継ぐ（ワークツリーのBoardが起動時にリポジトリ側へ移らない）", async () => {
    const store = createStore({
      "board-1": {
        preset: "dev",
        restoreMode: "restore",
        cwd: "/repo/main",
        tabCwd: "/repo/work/feature",
      },
    });

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "layout",
    });

    expect(result).toEqual({
      ok: true,
      boardId: "board-1",
      startup: {
        preset: "dev",
        restoreMode: "layout",
        cwd: "/repo/main",
        tabCwd: "/repo/work/feature",
      },
    });
  });

  test("presetを指定し直したらtabCwdは引き継がない（そのディレクトリで組み直す指定のため）", async () => {
    const store = createStore({
      "board-1": {
        preset: "dev",
        restoreMode: "layout",
        cwd: "/repo/main",
        tabCwd: "/repo/work/feature",
      },
    });

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "layout",
      preset: "work",
      cwd: "/home/me",
    });

    expect(result).toEqual({
      ok: true,
      boardId: "board-1",
      startup: { preset: "work", restoreMode: "layout", cwd: "/home/me" },
    });
  });

  test("mode:clearは紐づけごと解除する", async () => {
    const store = createStore({ "board-1": { preset: "dev", restoreMode: "layout" } });

    const result = await changeBoardStartup(store, LAYOUTS, { boardId: "board-1", mode: "clear" });

    expect(result).toEqual({ ok: true, boardId: "board-1", startup: null });
    expect(store.startups.has("board-1")).toBe(false);
  });

  test("存在しないboardIdは404を返す", async () => {
    const result = await changeBoardStartup(createStore(), LAYOUTS, {
      boardId: "board-missing",
      mode: "layout",
      preset: "dev",
    });

    expect(result).toEqual({ ok: false, status: 404, error: "board not found: board-missing" });
  });

  test("プリセット未紐づけでpreset省略は400を返す", async () => {
    const result = await changeBoardStartup(createStore(), LAYOUTS, {
      boardId: "board-1",
      mode: "layout",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 400 });
  });

  test("設定に存在しないpresetは404を返す", async () => {
    const result = await changeBoardStartup(createStore(), LAYOUTS, {
      boardId: "board-1",
      mode: "layout",
      preset: "nope",
    });

    expect(result).toEqual({ ok: false, status: 404, error: "layout not found: nope" });
  });

  test("紐づけ済みのプリセットが設定から消えていた場合、mode切り替えは404を返す", async () => {
    const store = createStore({ "board-1": { preset: "gone", restoreMode: "restore" } });

    const result = await changeBoardStartup(store, LAYOUTS, { boardId: "board-1", mode: "layout" });

    expect(result).toEqual({ ok: false, status: 404, error: "layout not found: gone" });
  });

  test("プロジェクトローカル由来のpresetはtrust無しだとneedsTrustを返し、紐づけを作らない", async () => {
    const root = await createProjectRoot("local");
    const store = createStore();

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "layout",
      preset: "local",
      cwd: root,
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ needsTrust: { projectRoot: root, preset: "local" } });
    // trust待ちは失敗ではなく再送を促す応答なので、HTTPのエラーステータスは付けない
    expect(result).not.toHaveProperty("status");
    expect(store.startups.has("board-1")).toBe(false);
  });

  test("trust: trueならプロジェクトローカル由来でも解決元ごと紐づける", async () => {
    const root = await createProjectRoot("local");
    const store = createStore();

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "layout",
      preset: "local",
      cwd: root,
      trust: true,
    });

    expect(result).toEqual({
      ok: true,
      boardId: "board-1",
      startup: { preset: "local", restoreMode: "layout", projectRoot: root },
    });
  });

  test("mode:restoreはプロジェクトローカル由来でもtrust無しで通る（起動時の自動実行が止まる方向のため）", async () => {
    const root = await createProjectRoot("local");
    const store = createStore({
      "board-1": { preset: "local", restoreMode: "layout", projectRoot: root },
    });

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "restore",
    });

    expect(result).toEqual({
      ok: true,
      boardId: "board-1",
      startup: { preset: "local", restoreMode: "restore", projectRoot: root },
    });
  });

  test("restoreからlayoutへ戻すときも改めてtrustを要求する", async () => {
    const root = await createProjectRoot("local");
    const store = createStore({
      "board-1": { preset: "local", restoreMode: "restore", projectRoot: root },
    });

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "layout",
    });

    expect(result).toMatchObject({ ok: false, needsTrust: { projectRoot: root, preset: "local" } });
  });

  test("preset省略時は解決元ごと引き継ぐ（別ディレクトリから叩いても入れ替わらない）", async () => {
    const root = await createProjectRoot("local");
    const store = createStore({
      "board-1": { preset: "local", restoreMode: "layout", projectRoot: root },
    });

    const result = await changeBoardStartup(store, LAYOUTS, {
      boardId: "board-1",
      mode: "layout",
      cwd: tmpdir(),
      trust: true,
    });

    expect(result).toMatchObject({
      ok: true,
      startup: { preset: "local", restoreMode: "layout", projectRoot: root },
    });
  });
});

function createTestWorkspaceManager(): WorkspaceManager {
  let sessionCount = 0;
  const createSession = (): TerminalSession => {
    const index = sessionCount++;
    return {
      write: () => {},
      runCommandWhenReady: () => {},
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
        viewportOffset: 0,
        mouseTracking: false,
        mouseAnyMotion: false,
        mouseShape: "text",
        paletteCss: null,
        copyMode: null,
        kittyPlacements: [],
        kittyImages: [],
      }),
      dumpText: () => `screen-text-${index}`,
      getRunningCommand: () => null,
      showNotice: () => {},
      setCallbacks: () => {},
      jumpPrompt: () => false,
      isCopyMode: () => false,
      enterCopyMode: () => {},
      exitCopyMode: () => {},
      handleCopyModeKey: () => false,
      dispose: () => {},
    };
  };
  return createWorkspaceManager({
    initialCols: 80,
    initialRows: 24,
    onDirty: () => {},
    onAllWorkspacesClosed: () => {},
    createSession,
  });
}

describe("applyAndBindStartupLayout", () => {
  test("プリセットをその場で適用し、起動時レイアウトとしても紐づける", async () => {
    const mgr = createTestWorkspaceManager();
    const boardId = mgr.snapshot().workspace.activeBoardId as string;
    // 適用前に分割しておき、replaceで畳み直されることを確かめる
    mgr.splitTile((mgr.snapshot().workspace.board!.layout as TileLeaf).id, "vertical");

    const result = await applyAndBindStartupLayout(mgr, [], NAMED_LAYOUTS, {
      boardId,
      preset: "named",
    });

    expect(result).toEqual({
      ok: true,
      boardId,
      startup: { preset: "named", restoreMode: "layout" },
    });
    expect(mgr.getBoardStartup(boardId)).toEqual({ preset: "named", restoreMode: "layout" });
    const leaf = mgr.snapshot().workspace.board!.layout as TileLeaf;
    expect(leaf.kind).toBe("leaf");
    expect(mgr.snapshot().workspace.board!.tabNames[leaf.tabIds[0] as string]).toBe("editor");
  });

  test("グローバル設定由来のプリセットは適用時のcwdを紐づけにも残す", async () => {
    const mgr = createTestWorkspaceManager();
    const boardId = mgr.snapshot().workspace.activeBoardId as string;
    const cwd = await mkdtemp(join(tmpdir(), "niwaterm-startup-cwd-"));

    const result = await applyAndBindStartupLayout(mgr, [], NAMED_LAYOUTS, {
      boardId,
      preset: "named",
      cwd,
    });

    expect(result).toEqual({
      ok: true,
      boardId,
      startup: { preset: "named", restoreMode: "layout", cwd },
    });
    expect(mgr.getBoardStartup(boardId)).toEqual({
      preset: "named",
      restoreMode: "layout",
      cwd,
    });
  });

  test("存在しないpresetは適用も紐づけもしない", async () => {
    const mgr = createTestWorkspaceManager();
    const boardId = mgr.snapshot().workspace.activeBoardId as string;

    const result = await applyAndBindStartupLayout(mgr, [], NAMED_LAYOUTS, {
      boardId,
      preset: "nope",
    });

    expect(result).toEqual({ ok: false, error: "layout not found: nope" });
    expect(mgr.getBoardStartup(boardId)).toBeNull();
  });

  test("存在しないboardIdはエラーを返す", async () => {
    const mgr = createTestWorkspaceManager();

    const result = await applyAndBindStartupLayout(mgr, [], NAMED_LAYOUTS, {
      boardId: "board-missing",
      preset: "named",
    });

    expect(result).toEqual({ ok: false, error: "board not found: board-missing" });
  });

  test("プロジェクトローカル由来のpresetはtrust無しだと適用も紐づけもしない", async () => {
    const root = await createProjectRoot("local");
    const mgr = createTestWorkspaceManager();
    const boardId = mgr.snapshot().workspace.activeBoardId as string;
    const tabsBefore = (mgr.snapshot().workspace.board!.layout as TileLeaf).tabIds.length;

    const result = await applyAndBindStartupLayout(mgr, [], NAMED_LAYOUTS, {
      boardId,
      preset: "local",
      cwd: root,
    });

    expect(result).toMatchObject({ ok: false, needsTrust: { projectRoot: root, preset: "local" } });
    expect(mgr.getBoardStartup(boardId)).toBeNull();
    expect((mgr.snapshot().workspace.board!.layout as TileLeaf).tabIds.length).toBe(tabsBefore);
  });

  test("trust: trueならプロジェクトローカル由来でも適用し、解決元ごと紐づける", async () => {
    const root = await createProjectRoot("local");
    const mgr = createTestWorkspaceManager();
    const boardId = mgr.snapshot().workspace.activeBoardId as string;

    const result = await applyAndBindStartupLayout(mgr, [], NAMED_LAYOUTS, {
      boardId,
      preset: "local",
      cwd: root,
      trust: true,
    });

    expect(result).toEqual({
      ok: true,
      boardId,
      startup: { preset: "local", restoreMode: "layout", projectRoot: root },
    });
  });
});
