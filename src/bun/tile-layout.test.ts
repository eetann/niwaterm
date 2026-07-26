import { describe, expect, test } from "bun:test";
import {
  closeTile,
  findNode,
  focusNeighbor,
  listLeaves,
  resizeSplit,
  splitTile,
  type TileLeaf,
  type TileNode,
  toFlexDirection,
} from "./tile-layout";

function leaf(id: string, tabId = `${id}-tab`): TileLeaf {
  return { kind: "leaf", id, tabIds: [tabId], activeTabId: tabId };
}

describe("toFlexDirection", () => {
  test.each([
    ["horizontal", "column"],
    ["vertical", "row"],
  ] as const)("toFlexDirection(%s) -> %s", (orientation, expected) => {
    expect(toFlexDirection(orientation)).toBe(expected);
  });
});

describe("splitTile", () => {
  test("leafをsplitに置き換え、first=既存/second=新規になる", () => {
    const tree = leaf("a");
    const result = splitTile(tree, "a", "row", "split-1", "b", "b-tab");
    expect(result).not.toBeNull();
    const split = result?.tree as TileNode;
    expect(split).toEqual({
      kind: "split",
      id: "split-1",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b", "b-tab"),
    });
    expect(result?.newTileId).toBe("b");
    expect(result?.newTabId).toBe("b-tab");
  });

  test("存在しないidはnullを返す", () => {
    const tree = leaf("a");
    expect(splitTile(tree, "not-found", "row", "s", "b", "b-tab")).toBeNull();
  });

  test("splitノードのidを指定した場合もnullを返す（leafのみ分割可能）", () => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b"),
    };
    expect(splitTile(tree, "root", "row", "s", "c", "c-tab")).toBeNull();
  });

  test("無関係な兄弟部分木は参照が同一（構造共有）", () => {
    const sibling = leaf("sibling");
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: sibling,
    };
    const result = splitTile(tree, "a", "column", "s2", "c", "c-tab");
    const newTree = result?.tree as TileNode & { kind: "split" };
    expect(newTree.second).toBe(sibling);
  });
});

describe("closeTile", () => {
  test("兄弟leafを閉じると親splitが生き残った兄弟に置き換わる", () => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b"),
    };
    const result = closeTile(tree, "a");
    expect(result.tree).toEqual(leaf("b"));
    expect(result.closedTabIds).toEqual(["a-tab"]);
  });

  test("3階層のネストからの削除で正しく再親化される", () => {
    // root(row) = a | (column) = b | c
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.3,
      first: leaf("a"),
      second: {
        kind: "split",
        id: "inner",
        direction: "column",
        ratio: 0.5,
        first: leaf("b"),
        second: leaf("c"),
      },
    };
    const result = closeTile(tree, "b");
    expect(result.tree).toEqual({
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.3,
      first: leaf("a"),
      second: leaf("c"),
    });
    expect(result.closedTabIds).toEqual(["b-tab"]);
  });

  test("複数tabIdを持つleafを閉じるとclosedTabIdsが全件拾われる", () => {
    const multiTabLeaf: TileLeaf = {
      kind: "leaf",
      id: "a",
      tabIds: ["t1", "t2"],
      activeTabId: "t1",
    };
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: multiTabLeaf,
      second: leaf("b"),
    };
    const result = closeTile(tree, "a");
    expect(result.closedTabIds).toEqual(["t1", "t2"]);
  });

  test("最後の1枚を閉じようとするとtree:nullを返す", () => {
    const tree = leaf("a");
    const result = closeTile(tree, "a");
    expect(result.tree).toBeNull();
    expect(result.closedTabIds).toEqual(["a-tab"]);
  });

  test("存在しないidを指定すると木は変化しない", () => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b"),
    };
    const result = closeTile(tree, "not-found");
    expect(result.tree).toBe(tree);
    expect(result.closedTabIds).toEqual([]);
  });
});

describe("findNode / listLeaves", () => {
  const tree: TileNode = {
    kind: "split",
    id: "root",
    direction: "row",
    ratio: 0.5,
    first: leaf("a"),
    second: {
      kind: "split",
      id: "inner",
      direction: "column",
      ratio: 0.5,
      first: leaf("b"),
      second: leaf("c"),
    },
  };

  test("findNodeはleaf/splitどちらのidでも解決できる", () => {
    expect(findNode(tree, "a")).toEqual(leaf("a"));
    expect(findNode(tree, "inner")).toEqual((tree as TileNode & { kind: "split" }).second);
    expect(findNode(tree, "not-found")).toBeUndefined();
  });

  test("listLeavesは深さ優先でleafを列挙する", () => {
    expect(listLeaves(tree).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});

describe("resizeSplit", () => {
  const tree: TileNode = {
    kind: "split",
    id: "root",
    direction: "row",
    ratio: 0.5,
    first: leaf("a"),
    second: {
      kind: "split",
      id: "inner",
      direction: "column",
      ratio: 0.5,
      first: leaf("b"),
      second: leaf("c"),
    },
  };

  test("対象splitのratioが更新される", () => {
    const result = resizeSplit(tree, "root", 0.7);
    expect((result as TileNode & { kind: "split" }).ratio).toBe(0.7);
  });

  test.each([
    [0.0, 0.1],
    [1.0, 0.9],
    [-5, 0.1],
    [5, 0.9],
  ])("範囲外ratio %p は %p にクランプされる", (input, expected) => {
    const result = resizeSplit(tree, "root", input);
    expect((result as TileNode & { kind: "split" }).ratio).toBe(expected);
  });

  test("対象外のsplitノードは参照が同一のまま", () => {
    const result = resizeSplit(tree, "inner", 0.7) as TileNode & { kind: "split" };
    expect(result.first).toBe((tree as TileNode & { kind: "split" }).first);
  });
});

describe("focusNeighbor", () => {
  test.each([
    ["a", "right", "b"],
    ["b", "left", "a"],
    ["a", "up", null],
    ["a", "down", null],
  ] as const)("横並び2ペイン: %s から %s -> %p", (from, direction, expected) => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b"),
    };
    expect(focusNeighbor(tree, from, direction)).toBe(expected);
  });

  test.each([
    ["a", "down", "b"],
    ["b", "up", "a"],
    ["a", "left", null],
    ["a", "right", null],
  ] as const)("縦積み2ペイン: %s から %s -> %p", (from, direction, expected) => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "column",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b"),
    };
    expect(focusNeighbor(tree, from, direction)).toBe(expected);
  });

  test.each([
    ["a", "right", "c"],
    ["a", "down", "b"],
    ["c", "left", "a"],
    ["d", "up", "c"],
    ["b", "right", "d"],
  ] as const)("2x2ネスト: %s から %s -> %p", (from, direction, expected) => {
    // root(row) = column(a, b) | column(c, d)
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: {
        kind: "split",
        id: "left",
        direction: "column",
        ratio: 0.5,
        first: leaf("a"),
        second: leaf("b"),
      },
      second: {
        kind: "split",
        id: "right",
        direction: "column",
        ratio: 0.5,
        first: leaf("c"),
        second: leaf("d"),
      },
    };
    expect(focusNeighbor(tree, from, direction)).toBe(expected);
  });

  test("不均等3分割でも中心座標に基づいて正しく隣接判定する", () => {
    // root(row, ratio 0.2) = a | row(b, c)
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.2,
      first: leaf("a"),
      second: {
        kind: "split",
        id: "inner",
        direction: "row",
        ratio: 0.5,
        first: leaf("b"),
        second: leaf("c"),
      },
    };
    expect(focusNeighbor(tree, "a", "right")).toBe("b");
    expect(focusNeighbor(tree, "c", "left")).toBe("b");
    expect(focusNeighbor(tree, "b", "left")).toBe("a");
  });

  test("存在しないfocusedTileIdはnullを返す", () => {
    const tree = leaf("a");
    expect(focusNeighbor(tree, "not-found", "right")).toBeNull();
  });
});
