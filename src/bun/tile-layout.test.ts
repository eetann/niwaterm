import { describe, expect, test } from "bun:test";
import {
  addTabToTile,
  closeTabInTile,
  closeTile,
  findNode,
  focusNeighbor,
  listLeaves,
  moveTabToTile,
  nextTabId,
  resizeSplit,
  splitTile,
  switchActiveTab,
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

describe("addTabToTile", () => {
  test("leafのtabIds末尾に追加し、activeTabIdが新タブになる", () => {
    const tree = leaf("a");
    const result = addTabToTile(tree, "a", "a-tab2");
    expect(result).toEqual({
      kind: "leaf",
      id: "a",
      tabIds: ["a-tab", "a-tab2"],
      activeTabId: "a-tab2",
    });
  });

  test("存在しないtileIdはnullを返す", () => {
    const tree = leaf("a");
    expect(addTabToTile(tree, "not-found", "new-tab")).toBeNull();
  });

  test("無関係な兄弟部分木は参照が同一（構造共有）", () => {
    const sibling = leaf("b");
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: sibling,
    };
    const result = addTabToTile(tree, "a", "a-tab2") as TileNode & { kind: "split" };
    expect(result.second).toBe(sibling);
  });
});

describe("switchActiveTab", () => {
  const multiTabLeaf: TileLeaf = {
    kind: "leaf",
    id: "a",
    tabIds: ["t1", "t2", "t3"],
    activeTabId: "t1",
  };

  test("tabIdsに存在するtabIdへactiveTabIdが切り替わる", () => {
    const result = switchActiveTab(multiTabLeaf, "a", "t3");
    expect(result).toEqual({ ...multiTabLeaf, activeTabId: "t3" });
  });

  test("存在しないtileIdはnullを返す", () => {
    expect(switchActiveTab(multiTabLeaf, "not-found", "t2")).toBeNull();
  });

  test("そのleafのtabIdsに含まれないtabIdはnullを返す", () => {
    expect(switchActiveTab(multiTabLeaf, "a", "not-a-tab")).toBeNull();
  });

  test("既にactiveなtabIdを指定すると同一参照を返す", () => {
    expect(switchActiveTab(multiTabLeaf, "a", "t1")).toBe(multiTabLeaf);
  });
});

describe("closeTabInTile", () => {
  test("複数タブのうちactiveでないタブを閉じてもactiveTabIdは変わらない", () => {
    const multiTabLeaf: TileLeaf = {
      kind: "leaf",
      id: "a",
      tabIds: ["t1", "t2", "t3"],
      activeTabId: "t2",
    };
    const result = closeTabInTile(multiTabLeaf, "a", "t3");
    expect(result).toEqual({
      tree: { kind: "leaf", id: "a", tabIds: ["t1", "t2"], activeTabId: "t2" },
      closedTabId: "t3",
      tileClosed: false,
    });
  });

  test.each([
    [["t1", "t2", "t3"], "t1", "t2"],
    [["t1", "t2", "t3"], "t2", "t1"],
    [["t1", "t2", "t3"], "t3", "t2"],
  ] as const)(
    "activeなタブ%pのうち%pを閉じるとactiveTabIdは%pへ付け替わる（前優先、先頭なら次）",
    (tabIds, closing, expectedActive) => {
      const multiTabLeaf: TileLeaf = {
        kind: "leaf",
        id: "a",
        tabIds: [...tabIds],
        activeTabId: closing,
      };
      const result = closeTabInTile(multiTabLeaf, "a", closing);
      const newTabIds = tabIds.filter((id) => id !== closing);
      expect(result).toEqual({
        tree: { kind: "leaf", id: "a", tabIds: newTabIds, activeTabId: expectedActive },
        closedTabId: closing,
        tileClosed: false,
      });
    },
  );

  test("最後の1タブを閉じるとtileごと畳まれる（tileClosed: true）", () => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b"),
    };
    const result = closeTabInTile(tree, "a", "a-tab");
    expect(result).toEqual({ tree: leaf("b"), closedTabId: "a-tab", tileClosed: true });
  });

  test("最後の1枚のtileの最後のタブを閉じるとtree:nullになる", () => {
    const tree = leaf("a");
    const result = closeTabInTile(tree, "a", "a-tab");
    expect(result).toEqual({ tree: null, closedTabId: "a-tab", tileClosed: true });
  });

  test("存在しないtileIdはnullを返す", () => {
    const tree = leaf("a");
    expect(closeTabInTile(tree, "not-found", "a-tab")).toBeNull();
  });

  test("そのleafのtabIdsに含まれないtabIdはnullを返す", () => {
    const tree = leaf("a");
    expect(closeTabInTile(tree, "a", "not-a-tab")).toBeNull();
  });
});

describe("moveTabToTile", () => {
  test("複数タブのleafから1つ移動すると、移動元は残り、移動先の末尾に追加されactiveになる", () => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: { kind: "leaf", id: "a", tabIds: ["t1", "t2"], activeTabId: "t1" },
      second: leaf("b"),
    };
    const result = moveTabToTile(tree, "a", "t2", "b");
    expect(result).toEqual({
      tree: {
        kind: "split",
        id: "root",
        direction: "row",
        ratio: 0.5,
        first: { kind: "leaf", id: "a", tabIds: ["t1"], activeTabId: "t1" },
        second: { kind: "leaf", id: "b", tabIds: ["b-tab", "t2"], activeTabId: "t2" },
      },
    });
  });

  test("移動元が最後の1タブだった場合、tileごと畳まれ removedTileId が返る", () => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b"),
    };
    const result = moveTabToTile(tree, "a", "a-tab", "b");
    expect(result).toEqual({
      tree: { kind: "leaf", id: "b", tabIds: ["b-tab", "a-tab"], activeTabId: "a-tab" },
      removedTileId: "a",
    });
  });

  test("fromTileIdとtoTileIdが同一の場合はnullを返す", () => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b"),
    };
    expect(moveTabToTile(tree, "a", "a-tab", "a")).toBeNull();
  });

  test("移動元にtabIdが存在しない場合はnullを返す", () => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b"),
    };
    expect(moveTabToTile(tree, "a", "not-a-tab", "b")).toBeNull();
  });

  test("移動先tileIdが存在しない場合はnullを返す", () => {
    const tree: TileNode = {
      kind: "split",
      id: "root",
      direction: "row",
      ratio: 0.5,
      first: leaf("a"),
      second: leaf("b"),
    };
    expect(moveTabToTile(tree, "a", "a-tab", "not-found")).toBeNull();
  });

  test("移動先がsplitノードのidの場合はnullを返す（leafのみ移動先にできる）", () => {
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
    expect(moveTabToTile(tree, "a", "a-tab", "inner")).toBeNull();
  });

  test("3階層ネストでの移動でも正しく再親化される", () => {
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
    const result = moveTabToTile(tree, "b", "b-tab", "c");
    expect(result).toEqual({
      tree: {
        kind: "split",
        id: "root",
        direction: "row",
        ratio: 0.3,
        first: leaf("a"),
        second: { kind: "leaf", id: "c", tabIds: ["c-tab", "b-tab"], activeTabId: "b-tab" },
      },
      removedTileId: "b",
    });
  });
});

describe("nextTabId", () => {
  const multiTabLeaf: TileLeaf = {
    kind: "leaf",
    id: "a",
    tabIds: ["t1", "t2", "t3"],
    activeTabId: "t2",
  };

  test.each([
    [1, "t3"],
    [-1, "t1"],
  ] as const)("delta=%p のとき %p", (delta, expected) => {
    expect(nextTabId(multiTabLeaf, delta)).toBe(expected);
  });

  test("末尾からdelta=1で巡回して先頭へ戻る", () => {
    const leafAtEnd: TileLeaf = { ...multiTabLeaf, activeTabId: "t3" };
    expect(nextTabId(leafAtEnd, 1)).toBe("t1");
  });

  test("先頭からdelta=-1で巡回して末尾へ戻る", () => {
    const leafAtStart: TileLeaf = { ...multiTabLeaf, activeTabId: "t1" };
    expect(nextTabId(leafAtStart, -1)).toBe("t3");
  });

  test("タブが1件のみの場合は常に同じtabIdを返す", () => {
    const singleTabLeaf: TileLeaf = {
      kind: "leaf",
      id: "a",
      tabIds: ["only"],
      activeTabId: "only",
    };
    expect(nextTabId(singleTabLeaf, 1)).toBe("only");
    expect(nextTabId(singleTabLeaf, -1)).toBe("only");
  });
});
