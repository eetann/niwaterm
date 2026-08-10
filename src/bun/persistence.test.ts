import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTreeFromPersisted,
  loadPersistedState,
  persistedFilePath,
  type PersistedState,
  type PersistedTileNode,
  savePersistedState,
  toPersistedTileNode,
} from "./persistence";
import type { TileNode } from "./tile-layout";

describe("toPersistedTileNode", () => {
  test("leafはtabCountとactiveTabIndexに変換される", () => {
    const tree: TileNode = {
      kind: "leaf",
      id: "tile-1",
      tabIds: ["tab-1", "tab-2", "tab-3"],
      activeTabId: "tab-2",
    };
    expect(toPersistedTileNode(tree)).toEqual({ kind: "leaf", tabCount: 3, activeTabIndex: 1 });
  });

  test("splitは再帰的に変換され、direction/ratioが保持される", () => {
    const tree: TileNode = {
      kind: "split",
      id: "split-1",
      direction: "row",
      ratio: 0.3,
      first: { kind: "leaf", id: "tile-1", tabIds: ["tab-1"], activeTabId: "tab-1" },
      second: {
        kind: "split",
        id: "split-2",
        direction: "column",
        ratio: 0.5,
        first: { kind: "leaf", id: "tile-2", tabIds: ["tab-2"], activeTabId: "tab-2" },
        second: { kind: "leaf", id: "tile-3", tabIds: ["tab-3"], activeTabId: "tab-3" },
      },
    };
    expect(toPersistedTileNode(tree)).toEqual({
      kind: "split",
      direction: "row",
      ratio: 0.3,
      first: { kind: "leaf", tabCount: 1, activeTabIndex: 0 },
      second: {
        kind: "split",
        direction: "column",
        ratio: 0.5,
        first: { kind: "leaf", tabCount: 1, activeTabIndex: 0 },
        second: { kind: "leaf", tabCount: 1, activeTabIndex: 0 },
      },
    });
  });
});

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

describe("buildTreeFromPersisted", () => {
  test("leafはtabCount分のtabIdsを新規採番して再構築する", () => {
    const node: PersistedTileNode = { kind: "leaf", tabCount: 3, activeTabIndex: 1 };
    const tree = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    expect(tree).toEqual({
      kind: "leaf",
      id: "tile-0",
      tabIds: ["tab-0", "tab-1", "tab-2"],
      activeTabId: "tab-1",
    });
  });

  test("splitは再帰的に再構築される", () => {
    const node: PersistedTileNode = {
      kind: "split",
      direction: "row",
      ratio: 0.4,
      first: { kind: "leaf", tabCount: 1, activeTabIndex: 0 },
      second: { kind: "leaf", tabCount: 2, activeTabIndex: 1 },
    };
    const tree = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    expect(tree).toEqual({
      kind: "split",
      id: "tile-0",
      direction: "row",
      ratio: 0.4,
      first: { kind: "leaf", id: "tile-1", tabIds: ["tab-0"], activeTabId: "tab-0" },
      second: { kind: "leaf", id: "tile-2", tabIds: ["tab-1", "tab-2"], activeTabId: "tab-2" },
    });
  });

  test("tabCount 0以下は1件として扱う", () => {
    const node: PersistedTileNode = { kind: "leaf", tabCount: 0, activeTabIndex: 0 };
    const tree = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    expect(tree.kind === "leaf" && tree.tabIds).toEqual(["tab-0"]);
  });

  test("activeTabIndexが範囲外なら末尾にクランプする", () => {
    const node: PersistedTileNode = { kind: "leaf", tabCount: 2, activeTabIndex: 99 };
    const tree = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    expect(tree.kind === "leaf" && tree.activeTabId).toBe("tab-1");
  });

  test("toPersistedTileNode -> buildTreeFromPersisted -> toPersistedTileNode でラウンドトリップする", () => {
    const original: TileNode = {
      kind: "split",
      id: "s1",
      direction: "column",
      ratio: 0.25,
      first: { kind: "leaf", id: "t1", tabIds: ["a", "b"], activeTabId: "b" },
      second: { kind: "leaf", id: "t2", tabIds: ["c"], activeTabId: "c" },
    };
    const persisted = toPersistedTileNode(original);
    const rebuilt = buildTreeFromPersisted(persisted, counter("tile"), counter("tab"));
    expect(toPersistedTileNode(rebuilt)).toEqual(persisted);
  });
});

describe("loadPersistedState / savePersistedState", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-persistence-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("保存→読み込みでラウンドトリップする", async () => {
    const path = join(dir, "nested", "workspaces.json");
    const state: PersistedState = {
      version: 1,
      activeWorkspaceIndex: 1,
      workspaces: [
        { layout: { kind: "leaf", tabCount: 1, activeTabIndex: 0 } },
        {
          layout: {
            kind: "split",
            direction: "row",
            ratio: 0.5,
            first: { kind: "leaf", tabCount: 2, activeTabIndex: 1 },
            second: { kind: "leaf", tabCount: 1, activeTabIndex: 0 },
          },
        },
      ],
    };
    await savePersistedState(path, state);
    expect(await loadPersistedState(path)).toEqual(state);
  });

  test("ファイルが存在しない場合はnullを返す", async () => {
    expect(await loadPersistedState(join(dir, "not-found.json"))).toBeNull();
  });

  test("壊れたJSONの場合はnullを返す", async () => {
    const path = join(dir, "broken.json");
    await writeFile(path, "{ this is not valid json");
    expect(await loadPersistedState(path)).toBeNull();
  });

  test("versionが一致しない場合はnullを返す", async () => {
    const path = join(dir, "wrong-version.json");
    await writeFile(path, JSON.stringify({ version: 2, workspaces: [], activeWorkspaceIndex: 0 }));
    expect(await loadPersistedState(path)).toBeNull();
  });

  test("スキーマが不正な場合はnullを返す", async () => {
    const path = join(dir, "invalid-schema.json");
    await writeFile(path, JSON.stringify({ version: 1, workspaces: "not-an-array" }));
    expect(await loadPersistedState(path)).toBeNull();
  });
});

describe("persistedFilePath", () => {
  test("アプリケーションサポートディレクトリ配下のniwaterm/workspaces.jsonを指す", () => {
    // Windowsは%APPDATA%配下、それ以外(macOS)はApplication Support配下
    expect(persistedFilePath()).toMatch(
      process.platform === "win32"
        ? /Roaming\\niwaterm\\workspaces\.json$/
        : /Library\/Application Support\/niwaterm\/workspaces\.json$/,
    );
  });
});
