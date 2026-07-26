// ワークスペースのレイアウト骨格（分割構造・タブ数）だけを永続化する。
// PTYのcwd・スクロールバック・プロセスそのものは対象外（roadmap「磨き込みと配布」で扱う）。
// 復元時は各タブに対して新規シェルを起動するため、tabIds/tileIdの実体は保存せず
// 「そのleafに何個タブがあったか」「何番目がアクティブだったか」のみを保持する。

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { FlexDirection, TabId, TileId, TileNode } from "./tile-layout";

export interface PersistedTileLeaf {
  kind: "leaf";
  tabCount: number;
  activeTabIndex: number;
}

export interface PersistedTileSplit {
  kind: "split";
  direction: FlexDirection;
  ratio: number;
  first: PersistedTileNode;
  second: PersistedTileNode;
}

export type PersistedTileNode = PersistedTileLeaf | PersistedTileSplit;

export interface PersistedWorkspace {
  layout: PersistedTileNode;
}

export interface PersistedState {
  version: 1;
  workspaces: PersistedWorkspace[];
  activeWorkspaceIndex: number;
}

export function toPersistedTileNode(tree: TileNode): PersistedTileNode {
  if (tree.kind === "leaf") {
    return {
      kind: "leaf",
      tabCount: tree.tabIds.length,
      activeTabIndex: Math.max(0, tree.tabIds.indexOf(tree.activeTabId)),
    };
  }
  return {
    kind: "split",
    direction: tree.direction,
    ratio: tree.ratio,
    first: toPersistedTileNode(tree.first),
    second: toPersistedTileNode(tree.second),
  };
}

/** tabIds/tileIdは新規採番（genTileId/genTabId）で再構築する。実体は復元しない */
export function buildTreeFromPersisted(
  node: PersistedTileNode,
  genTileId: () => TileId,
  genTabId: () => TabId,
): TileNode {
  if (node.kind === "leaf") {
    const tabCount = Math.max(1, node.tabCount);
    const tabIds = Array.from({ length: tabCount }, () => genTabId());
    const activeIndex = Math.min(Math.max(0, node.activeTabIndex), tabIds.length - 1);
    return {
      kind: "leaf",
      id: genTileId(),
      tabIds,
      activeTabId: tabIds[activeIndex],
    };
  }
  return {
    kind: "split",
    id: genTileId(),
    direction: node.direction,
    ratio: node.ratio,
    first: buildTreeFromPersisted(node.first, genTileId, genTabId),
    second: buildTreeFromPersisted(node.second, genTileId, genTabId),
  };
}

export function persistedFilePath(): string {
  return join(homedir(), "Library", "Application Support", "niwaterm", "workspaces.json");
}

function isPersistedTileNode(value: unknown): value is PersistedTileNode {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["kind"] === "leaf") {
    return typeof v["tabCount"] === "number" && typeof v["activeTabIndex"] === "number";
  }
  if (v["kind"] === "split") {
    return (
      (v["direction"] === "row" || v["direction"] === "column") &&
      typeof v["ratio"] === "number" &&
      isPersistedTileNode(v["first"]) &&
      isPersistedTileNode(v["second"])
    );
  }
  return false;
}

function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["version"] !== 1) return false;
  if (typeof v["activeWorkspaceIndex"] !== "number") return false;
  const workspaces = v["workspaces"];
  if (!Array.isArray(workspaces)) return false;
  return workspaces.every(
    (w) =>
      typeof w === "object" &&
      w !== null &&
      isPersistedTileNode((w as Record<string, unknown>)["layout"]),
  );
}

/** ファイルが無い・JSONとして壊れている・スキーマ不一致のいずれでも例外を投げずnullを返す */
export async function loadPersistedState(path: string): Promise<PersistedState | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const data: unknown = await file.json();
    return isPersistedState(data) ? data : null;
  } catch {
    return null;
  }
}

export async function savePersistedState(path: string, state: PersistedState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(state, null, 2));
}
