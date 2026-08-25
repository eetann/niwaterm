import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTreeFromPersisted,
  loadPersistedState,
  persistedFilePath,
  type PersistedState,
  type PersistedTab,
  type PersistedTileNode,
  type PersistTreeContext,
  savePersistedState,
  toPersistedTileNode,
} from "./persistence";
import type { TileNode } from "./tile-layout";

describe("toPersistedTileNode", () => {
  test("leafはtabs配列とactiveTabIndexに変換される", () => {
    const tree: TileNode = {
      kind: "leaf",
      id: "tile-1",
      tabIds: ["tab-1", "tab-2", "tab-3"],
      activeTabId: "tab-2",
    };
    const ctx: PersistTreeContext = { focusedTileId: "tile-999", tabs: {}, tileNames: {} };
    expect(toPersistedTileNode(tree, ctx)).toEqual({
      kind: "leaf",
      tabs: [{ kind: "terminal" }, { kind: "terminal" }, { kind: "terminal" }],
      activeTabIndex: 1,
    });
  });

  test("tabsのメタ情報（terminal/browser）がctx.tabs経由で反映される", () => {
    const tree: TileNode = {
      kind: "leaf",
      id: "tile-1",
      tabIds: ["tab-1", "tab-2"],
      activeTabId: "tab-1",
    };
    const ctx: PersistTreeContext = {
      focusedTileId: "tile-999",
      tabs: {
        "tab-1": { kind: "terminal", shell: "wsl.exe -d NixOS", vars: { cwd: "/home/eetann" } },
        "tab-2": { kind: "browser", url: "https://example.com" },
      },
      tileNames: {},
    };
    const result = toPersistedTileNode(tree, ctx) as PersistedTileNode & { kind: "leaf" };
    expect(result.tabs).toEqual([
      { kind: "terminal", shell: "wsl.exe -d NixOS", vars: { cwd: "/home/eetann" } },
      { kind: "browser", url: "https://example.com" },
    ]);
  });

  test("フォーカスされているleafのみfocused:trueが付き、他は省略される", () => {
    const tree: TileNode = {
      kind: "split",
      id: "split-1",
      direction: "row",
      ratio: 0.5,
      first: { kind: "leaf", id: "tile-1", tabIds: ["tab-1"], activeTabId: "tab-1" },
      second: { kind: "leaf", id: "tile-2", tabIds: ["tab-2"], activeTabId: "tab-2" },
    };
    const ctx: PersistTreeContext = { focusedTileId: "tile-2", tabs: {}, tileNames: {} };
    const result = toPersistedTileNode(tree, ctx) as PersistedTileNode & { kind: "split" };
    expect((result.first as PersistedTileNode & { kind: "leaf" }).focused).toBeUndefined();
    expect((result.second as PersistedTileNode & { kind: "leaf" }).focused).toBe(true);
  });

  test("タイル名が設定されていればname、未設定ならキー自体が省略される", () => {
    const tree: TileNode = {
      kind: "split",
      id: "split-1",
      direction: "row",
      ratio: 0.5,
      first: { kind: "leaf", id: "tile-1", tabIds: ["tab-1"], activeTabId: "tab-1" },
      second: { kind: "leaf", id: "tile-2", tabIds: ["tab-2"], activeTabId: "tab-2" },
    };
    const ctx: PersistTreeContext = {
      focusedTileId: "tile-999",
      tabs: {},
      tileNames: { "tile-1": "editor" },
    };
    const result = toPersistedTileNode(tree, ctx) as PersistedTileNode & { kind: "split" };
    expect((result.first as PersistedTileNode & { kind: "leaf" }).name).toBe("editor");
    expect((result.second as PersistedTileNode & { kind: "leaf" }).name).toBeUndefined();
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
    const ctx: PersistTreeContext = { focusedTileId: "tile-999", tabs: {}, tileNames: {} };
    expect(toPersistedTileNode(tree, ctx)).toEqual({
      kind: "split",
      direction: "row",
      ratio: 0.3,
      first: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
      second: {
        kind: "split",
        direction: "column",
        ratio: 0.5,
        first: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
        second: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
      },
    });
  });
});

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

describe("buildTreeFromPersisted", () => {
  test("leafはtabs分のtabIdsを新規採番して再構築する", () => {
    const node: PersistedTileNode = {
      kind: "leaf",
      tabs: [{ kind: "terminal" }, { kind: "terminal" }, { kind: "terminal" }],
      activeTabIndex: 1,
    };
    const { tree } = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    expect(tree).toEqual({
      kind: "leaf",
      id: "tile-0",
      tabIds: ["tab-0", "tab-1", "tab-2"],
      activeTabId: "tab-1",
    });
  });

  test("terminal/browserのtabMetaがtabId単位で復元される", () => {
    const terminalTab: PersistedTab = {
      kind: "terminal",
      shell: "wsl.exe -d NixOS",
      vars: { cwd: "/home/eetann" },
      name: "work",
    };
    const browserTab: PersistedTab = { kind: "browser", url: "https://example.com" };
    const node: PersistedTileNode = {
      kind: "leaf",
      tabs: [terminalTab, browserTab],
      activeTabIndex: 0,
    };
    const { tree, tabMeta } = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    const tabIds = tree.kind === "leaf" ? tree.tabIds : [];
    expect(tabMeta.get(tabIds[0])).toEqual(terminalTab);
    expect(tabMeta.get(tabIds[1])).toEqual(browserTab);
  });

  test("タイル名が命名済みleafのtileIdに紐づく", () => {
    const node: PersistedTileNode = {
      kind: "split",
      direction: "row",
      ratio: 0.5,
      first: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0, name: "left" },
      second: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
    };
    const { tree, tileNames } = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    const firstId = tree.kind === "split" && tree.first.id;
    const secondId = tree.kind === "split" && tree.second.id;
    expect(tileNames.get(firstId as string)).toBe("left");
    expect(tileNames.has(secondId as string)).toBe(false);
  });

  test("focused: trueのleafの新tileIdがfocusedTileIdになる", () => {
    const node: PersistedTileNode = {
      kind: "split",
      direction: "row",
      ratio: 0.5,
      first: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
      second: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0, focused: true },
    };
    const { tree, focusedTileId } = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    const secondId = tree.kind === "split" && tree.second.id;
    expect(focusedTileId).toBe(secondId as string);
  });

  test("focusedが無指定の場合はnullになる", () => {
    const node: PersistedTileNode = {
      kind: "leaf",
      tabs: [{ kind: "terminal" }],
      activeTabIndex: 0,
    };
    const { focusedTileId } = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    expect(focusedTileId).toBeNull();
  });

  test("splitは再帰的に再構築される", () => {
    const node: PersistedTileNode = {
      kind: "split",
      direction: "row",
      ratio: 0.4,
      first: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
      second: {
        kind: "leaf",
        tabs: [{ kind: "terminal" }, { kind: "terminal" }],
        activeTabIndex: 1,
      },
    };
    const { tree } = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    expect(tree).toEqual({
      kind: "split",
      id: "tile-0",
      direction: "row",
      ratio: 0.4,
      first: { kind: "leaf", id: "tile-1", tabIds: ["tab-0"], activeTabId: "tab-0" },
      second: { kind: "leaf", id: "tile-2", tabIds: ["tab-1", "tab-2"], activeTabId: "tab-2" },
    });
  });

  test("tabsが空配列の場合は1件のterminalタブとして扱う", () => {
    const node: PersistedTileNode = { kind: "leaf", tabs: [], activeTabIndex: 0 };
    const { tree, tabMeta } = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
    const tabIds = tree.kind === "leaf" ? tree.tabIds : [];
    expect(tabIds).toEqual(["tab-0"]);
    expect(tabMeta.get("tab-0")).toEqual({ kind: "terminal" });
  });

  test("activeTabIndexが範囲外なら末尾にクランプする", () => {
    const node: PersistedTileNode = {
      kind: "leaf",
      tabs: [{ kind: "terminal" }, { kind: "terminal" }],
      activeTabIndex: 99,
    };
    const { tree } = buildTreeFromPersisted(node, counter("tile"), counter("tab"));
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
    const ctx: PersistTreeContext = {
      focusedTileId: "t2",
      tabs: {
        a: { kind: "terminal", name: "shell-a" },
        b: { kind: "terminal", vars: { cwd: "/tmp" } },
        c: { kind: "browser", url: "https://example.com" },
      },
      tileNames: { t1: "left-tile" },
    };
    const persisted = toPersistedTileNode(original, ctx);
    const { tree, tabMeta, tileNames, focusedTileId } = buildTreeFromPersisted(
      persisted,
      counter("tile"),
      counter("tab"),
    );
    const rebuiltCtx: PersistTreeContext = {
      focusedTileId: focusedTileId ?? "",
      tabs: Object.fromEntries(tabMeta),
      tileNames: Object.fromEntries(tileNames),
    };
    expect(toPersistedTileNode(tree, rebuiltCtx)).toEqual(persisted);
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
      version: 3,
      activeWorkspaceIndex: 1,
      workspaces: [
        {
          activeBoardIndex: 0,
          boards: [{ layout: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 } }],
        },
        {
          name: "second",
          activeBoardIndex: 0,
          boards: [
            {
              layout: {
                kind: "split",
                direction: "row",
                ratio: 0.5,
                first: {
                  kind: "leaf",
                  tabs: [
                    { kind: "terminal", shell: "wsl.exe -d NixOS", vars: { cwd: "/home/eetann" } },
                    { kind: "browser", url: "https://example.com" },
                  ],
                  activeTabIndex: 1,
                  name: "left",
                  focused: true,
                },
                second: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
              },
            },
          ],
        },
      ],
    };
    await savePersistedState(path, state);
    expect(await loadPersistedState(path)).toEqual(state);
  });

  test("version 2の旧形式ファイルは単一Boardのworkspaceとしてマイグレーションされる（ADR 0006）", async () => {
    const path = join(dir, "v2-migration.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        activeWorkspaceIndex: 0,
        workspaces: [
          {
            name: "legacy",
            layout: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 },
          },
          {
            layout: {
              kind: "leaf",
              tabs: [{ kind: "browser", url: "https://example.com" }],
              activeTabIndex: 0,
            },
          },
        ],
      }),
    );

    expect(await loadPersistedState(path)).toEqual({
      version: 3,
      activeWorkspaceIndex: 0,
      workspaces: [
        {
          name: "legacy",
          activeBoardIndex: 0,
          boards: [{ layout: { kind: "leaf", tabs: [{ kind: "terminal" }], activeTabIndex: 0 } }],
        },
        {
          activeBoardIndex: 0,
          boards: [
            {
              layout: {
                kind: "leaf",
                tabs: [{ kind: "browser", url: "https://example.com" }],
                activeTabIndex: 0,
              },
            },
          ],
        },
      ],
    });
  });

  test("ファイルが存在しない場合はnullを返す", async () => {
    expect(await loadPersistedState(join(dir, "not-found.json"))).toBeNull();
  });

  test("壊れたJSONの場合はnullを返す", async () => {
    const path = join(dir, "broken.json");
    await writeFile(path, "{ this is not valid json");
    expect(await loadPersistedState(path)).toBeNull();
  });

  test("versionが一致しない場合はnullを返す（旧v1ファイルは新スキーマで拒否される）", async () => {
    const path = join(dir, "wrong-version.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        workspaces: [{ layout: { kind: "leaf", tabCount: 1, activeTabIndex: 0 } }],
        activeWorkspaceIndex: 0,
      }),
    );
    expect(await loadPersistedState(path)).toBeNull();
  });

  test("スキーマが不正な場合はnullを返す", async () => {
    const path = join(dir, "invalid-schema.json");
    await writeFile(path, JSON.stringify({ version: 2, workspaces: "not-an-array" }));
    expect(await loadPersistedState(path)).toBeNull();
  });

  test("browserタブでurlが欠落している場合はnullを返す", async () => {
    const path = join(dir, "invalid-browser-tab.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        activeWorkspaceIndex: 0,
        workspaces: [{ layout: { kind: "leaf", tabs: [{ kind: "browser" }], activeTabIndex: 0 } }],
      }),
    );
    expect(await loadPersistedState(path)).toBeNull();
  });

  test("varsの値が文字列でない場合はnullを返す", async () => {
    const path = join(dir, "invalid-vars.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        activeWorkspaceIndex: 0,
        workspaces: [
          {
            layout: {
              kind: "leaf",
              tabs: [{ kind: "terminal", vars: { cwd: 123 } }],
              activeTabIndex: 0,
            },
          },
        ],
      }),
    );
    expect(await loadPersistedState(path)).toBeNull();
  });
});

describe("persistedFilePath", () => {
  test("アプリケーションサポートディレクトリ配下のniwaterm-wip-dev/workspaces.jsonを指す", () => {
    // Windowsは%APPDATA%配下、それ以外(macOS)はApplication Support配下。
    // テスト実行時はapp-variant.generated.tsのデフォルト値("niwaterm-wip-dev")が使われる
    expect(persistedFilePath()).toMatch(
      process.platform === "win32"
        ? /Roaming\\niwaterm-wip-dev\\workspaces\.json$/
        : /Library\/Application Support\/niwaterm-wip-dev\/workspaces\.json$/,
    );
  });
});
