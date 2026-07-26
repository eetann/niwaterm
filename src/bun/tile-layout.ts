// Tile木構造の純粋なデータ操作のみを持つ。I/O・PTY・FFIには一切依存しない。
// 将来のCLI操作（タイル一覧取得・外部からのレイアウト操作）でもそのまま再利用する想定。
// レイアウトの真実の情報源(source of truth)はbun側（workspace.ts）が持ち、
// この木構造はそのデータ表現を担う。

export type TileId = string;
export type TabId = string;

/** flexboxのflex-directionにそのまま対応する内部表現 */
export type FlexDirection = "row" | "column";

/** ユーザー向けの語彙（roadmap文言に合わせる） */
export type SplitOrientation = "horizontal" | "vertical";

/** 水平分割=水平な境界線で上下に積む=column、垂直分割=垂直な境界線で左右に並べる=row */
export function toFlexDirection(orientation: SplitOrientation): FlexDirection {
  return orientation === "horizontal" ? "column" : "row";
}

export interface TileLeaf {
  kind: "leaf";
  id: TileId;
  /** 表示順。現時点では常に1件（PTYは常にTabに紐づく、というADRの要請を反映） */
  tabIds: TabId[];
  activeTabId: TabId;
}

export interface TileSplit {
  kind: "split";
  id: TileId;
  direction: FlexDirection;
  /** 0 < ratio < 1。firstが占める比率 */
  ratio: number;
  first: TileNode;
  second: TileNode;
}

export type TileNode = TileLeaf | TileSplit;

const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

function clampRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

export interface SplitResult {
  tree: TileNode;
  newTileId: TileId;
  newTabId: TabId;
}

/**
 * targetTileIdのleafを、direction方向にfirst=既存/second=新規で2分割する。
 * 新規split/tile/tabのidは呼び出し側が生成して渡す（id採番はbun側に一元化する）。
 * targetTileIdが見つからない、またはleafでない場合はnullを返す。
 */
export function splitTile(
  tree: TileNode,
  targetTileId: TileId,
  direction: FlexDirection,
  newSplitId: TileId,
  newTileId: TileId,
  newTabId: TabId,
  ratio = 0.5,
): SplitResult | null {
  let found = false;

  function recurse(node: TileNode): TileNode {
    if (node.kind === "leaf") {
      if (node.id !== targetTileId) return node;
      found = true;
      const newLeaf: TileLeaf = {
        kind: "leaf",
        id: newTileId,
        tabIds: [newTabId],
        activeTabId: newTabId,
      };
      return {
        kind: "split",
        id: newSplitId,
        direction,
        ratio: clampRatio(ratio),
        first: node,
        second: newLeaf,
      };
    }
    const first = recurse(node.first);
    const second = recurse(node.second);
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  }

  const newTree = recurse(tree);
  if (!found) return null;
  return { tree: newTree, newTileId, newTabId };
}

export interface CloseResult {
  /** nullは「最後の1枚は閉じられない」を表す */
  tree: TileNode | null;
  closedTabIds: TabId[];
}

/** targetTileIdのleafを削除し、親splitを生き残った兄弟で置き換える（木を1段畳む） */
export function closeTile(tree: TileNode, targetTileId: TileId): CloseResult {
  function recurse(node: TileNode): { node: TileNode | null; closed: TabId[] } {
    if (node.kind === "leaf") {
      if (node.id !== targetTileId) return { node, closed: [] };
      return { node: null, closed: node.tabIds };
    }
    const first = recurse(node.first);
    if (first.node === null) {
      return { node: node.second, closed: first.closed };
    }
    const second = recurse(node.second);
    if (second.node === null) {
      return { node: first.node, closed: second.closed };
    }
    if (first.node === node.first && second.node === node.second) {
      return { node, closed: [] };
    }
    return {
      node: { ...node, first: first.node, second: second.node },
      closed: [...first.closed, ...second.closed],
    };
  }

  const result = recurse(tree);
  return { tree: result.node, closedTabIds: result.closed };
}

/** targetTileIdのleafの末尾にnewTabIdを追加し、activeTabIdを新タブへ切り替える */
export function addTabToTile(
  tree: TileNode,
  targetTileId: TileId,
  newTabId: TabId,
): TileNode | null {
  let found = false;

  function recurse(node: TileNode): TileNode {
    if (node.kind === "leaf") {
      if (node.id !== targetTileId) return node;
      found = true;
      return { ...node, tabIds: [...node.tabIds, newTabId], activeTabId: newTabId };
    }
    const first = recurse(node.first);
    const second = recurse(node.second);
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  }

  const newTree = recurse(tree);
  return found ? newTree : null;
}

/** targetTileIdのleaf内でactiveTabIdをtabIdへ切り替える。tabIdがそのleafに存在しない場合はnull */
export function switchActiveTab(
  tree: TileNode,
  targetTileId: TileId,
  tabId: TabId,
): TileNode | null {
  const target = findNode(tree, targetTileId);
  if (!target || target.kind !== "leaf" || !target.tabIds.includes(tabId)) return null;
  if (target.activeTabId === tabId) return tree;

  function recurse(node: TileNode): TileNode {
    if (node.kind === "leaf") {
      if (node.id !== targetTileId) return node;
      return { ...node, activeTabId: tabId };
    }
    const first = recurse(node.first);
    const second = recurse(node.second);
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  }

  return recurse(tree);
}

export interface CloseTabResult {
  /** nullは「最後のtileだった（closeTileと同じく最後の1枚は閉じられない）」を表す */
  tree: TileNode | null;
  closedTabId: TabId;
  /** trueの場合、tileごと閉じられた（そのtileの最後の1タブだった） */
  tileClosed: boolean;
}

/**
 * targetTileId内のtargetTabIdを閉じる。
 * leafに複数タブがあれば該当タブだけ除去し、activeTabIdだった場合は隣（除去位置の前、無ければ次）へ付け替える。
 * 最後の1タブだった場合はcloseTile()へ委譲しtile自体を畳む。
 * targetTileIdが存在しない・leafでない・tabIdがそのleafに含まれない場合はnullを返す。
 */
export function closeTabInTile(
  tree: TileNode,
  targetTileId: TileId,
  targetTabId: TabId,
): CloseTabResult | null {
  const target = findNode(tree, targetTileId);
  if (!target || target.kind !== "leaf" || !target.tabIds.includes(targetTabId)) {
    return null;
  }

  if (target.tabIds.length === 1) {
    const result = closeTile(tree, targetTileId);
    return { tree: result.tree, closedTabId: targetTabId, tileClosed: true };
  }

  const index = target.tabIds.indexOf(targetTabId);
  const newTabIds = target.tabIds.filter((id) => id !== targetTabId);
  const newActiveTabId =
    target.activeTabId === targetTabId
      ? index > 0
        ? newTabIds[index - 1]
        : newTabIds[0]
      : target.activeTabId;

  function recurse(node: TileNode): TileNode {
    if (node.kind === "leaf") {
      if (node.id !== targetTileId) return node;
      return { ...node, tabIds: newTabIds, activeTabId: newActiveTabId };
    }
    const first = recurse(node.first);
    const second = recurse(node.second);
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  }

  return { tree: recurse(tree), closedTabId: targetTabId, tileClosed: false };
}

/** leaf内でactiveTabIdからdelta方向へ巡回移動した次/前のtabIdを返す */
export function nextTabId(leaf: TileLeaf, delta: 1 | -1): TabId {
  const index = leaf.tabIds.indexOf(leaf.activeTabId);
  const len = leaf.tabIds.length;
  return leaf.tabIds[(index + delta + len) % len];
}

export function findNode(tree: TileNode, id: TileId): TileNode | undefined {
  if (tree.id === id) return tree;
  if (tree.kind === "split") {
    return findNode(tree.first, id) ?? findNode(tree.second, id);
  }
  return undefined;
}

export function listLeaves(tree: TileNode): TileLeaf[] {
  if (tree.kind === "leaf") return [tree];
  return [...listLeaves(tree.first), ...listLeaves(tree.second)];
}

/** splitId のratioを更新する。他のsplitノードは参照そのまま返す（構造共有、無駄な複製をしない） */
export function resizeSplit(tree: TileNode, splitId: TileId, ratio: number): TileNode {
  const clamped = clampRatio(ratio);

  function recurse(node: TileNode): TileNode {
    if (node.kind === "leaf") return node;
    if (node.id === splitId) {
      if (node.ratio === clamped) return node;
      return { ...node, ratio: clamped };
    }
    const first = recurse(node.first);
    const second = recurse(node.second);
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  }

  return recurse(tree);
}

/** 正規化座標(0..1)でのbox。focusNeighborの計算にのみ使う内部表現 */
interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function computeRects(
  node: TileNode,
  rect: NormalizedRect,
  out: Map<TileId, NormalizedRect>,
): void {
  if (node.kind === "leaf") {
    out.set(node.id, rect);
    return;
  }
  if (node.direction === "row") {
    const firstWidth = rect.width * node.ratio;
    computeRects(node.first, { x: rect.x, y: rect.y, width: firstWidth, height: rect.height }, out);
    computeRects(
      node.second,
      { x: rect.x + firstWidth, y: rect.y, width: rect.width - firstWidth, height: rect.height },
      out,
    );
  } else {
    const firstHeight = rect.height * node.ratio;
    computeRects(node.first, { x: rect.x, y: rect.y, width: rect.width, height: firstHeight }, out);
    computeRects(
      node.second,
      { x: rect.x, y: rect.y + firstHeight, width: rect.width, height: rect.height - firstHeight },
      out,
    );
  }
}

/**
 * focusedTileIdから見てdirection方向にある最も近いleafを返す（directional focusの簡易実装）。
 * 中心座標が指定方向にあるleafの中から、主軸方向の距離＋直交軸のズレ（重み付き）が最小のものを選ぶ。
 * 該当なしはnull（フォーカス変更なし）。
 */
export function focusNeighbor(
  tree: TileNode,
  focusedTileId: TileId,
  direction: "up" | "down" | "left" | "right",
): TileId | null {
  const rects = new Map<TileId, NormalizedRect>();
  computeRects(tree, { x: 0, y: 0, width: 1, height: 1 }, rects);
  const current = rects.get(focusedTileId);
  if (!current) return null;

  const currentCenterX = current.x + current.width / 2;
  const currentCenterY = current.y + current.height / 2;
  const EPS = 1e-9;

  let best: TileId | null = null;
  let bestDistance = Infinity;

  for (const [id, rect] of rects) {
    if (id === focusedTileId) continue;
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;

    if (direction === "left" && centerX >= currentCenterX - EPS) continue;
    if (direction === "right" && centerX <= currentCenterX + EPS) continue;
    if (direction === "up" && centerY >= currentCenterY - EPS) continue;
    if (direction === "down" && centerY <= currentCenterY + EPS) continue;

    const dx = centerX - currentCenterX;
    const dy = centerY - currentCenterY;
    const isHorizontal = direction === "left" || direction === "right";
    const primary = Math.abs(isHorizontal ? dx : dy);
    const cross = Math.abs(isHorizontal ? dy : dx);
    // 直交軸のズレに重みを掛け、「まっすぐ隣」を優先する
    const distance = primary + cross * 2;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }

  return best;
}
