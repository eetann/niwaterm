// niwaterm.config.tsのlayoutsプリセットをワークスペースへ適用するエンジン。
// workspace.ts/tile-layout.tsの内部構造には手を入れず、既存の高レベル操作
// （splitTile/newTab/setTabVar/setTabName/handleInput(send-keys)/closeTab/switchTab/focusTile）を
// 積み木のように呼び出して組み立てる（roadmapで決めた設計方針）。
//
// 各tileは「その時点で必ずタブを1つだけ持つプレースホルダー」という不変条件のもとに構築する:
// newWorkspace()直後のワークスペース、splitTileが新規に作る側のタイル、いずれも初期状態は
// 単一タブのため、この不変条件が常に成り立つ。tile用のタブを実際に作った後、
// プレースホルダーのタブだけを閉じることで、単一タブ操作の組み合わせのみで任意のタブ構成を作れる。

import type {
  LayoutNodeConfig,
  LayoutPreset,
  LayoutTabConfig,
  LayoutTileConfig,
  ShellProfile,
} from "@niwaterm/config";
import { resolveShellProfileCommand } from "./shell-profiles";
import { findNode, listLeaves, type TabId, type TileId } from "./tile-layout";
import { tmuxKeysToBytes } from "./tmux-keys";
import type { WorkspaceId, WorkspaceManager } from "./workspace-manager";

export type ApplyLayoutTarget = "new-workspace" | "replace";

export type ApplyLayoutResult =
  | { ok: true; workspaceId: WorkspaceId }
  | { ok: false; error: string };

// ---- バリデーション ----
// TypeScript設定ファイルのため大半の形状はコンパイル時に保証される想定だが、
// ratio範囲・shellProfileの実在確認・focus重複はいずれも実行時の状態（現在のshellProfiles、
// プリセット全体を横断した集計）に依存するため、apply直前にここで検証する。
// 検証を全て通過するまでワークスペースには一切手を触れない（半端に組み立てて失敗、を避けるため）

function validateNode(
  node: LayoutNodeConfig,
  path: string,
  profiles: ShellProfile[],
): string | null {
  if (node.kind === "tile") {
    if (!Array.isArray(node.tabs) || node.tabs.length === 0) {
      return `${path}: tile must have at least 1 tab`;
    }
    for (const [i, tab] of node.tabs.entries()) {
      if (tab.shellProfile !== undefined) {
        const resolved = resolveShellProfileCommand(profiles, tab.shellProfile);
        if (!resolved.ok) return `${path}.tabs[${i}]: ${resolved.error}`;
      }
      if (tab.cwd !== undefined && tab.cwd.length === 0) {
        return `${path}.tabs[${i}]: cwd must not be empty`;
      }
    }
    if (node.activeTab !== undefined) {
      if (
        !Number.isInteger(node.activeTab) ||
        node.activeTab < 0 ||
        node.activeTab >= node.tabs.length
      ) {
        return `${path}: activeTab is out of range`;
      }
    }
    return null;
  }
  if (node.orientation !== "horizontal" && node.orientation !== "vertical") {
    return `${path}: orientation must be "horizontal" or "vertical"`;
  }
  if (node.ratio !== undefined && (node.ratio <= 0 || node.ratio >= 1)) {
    return `${path}: ratio must be between 0 and 1 (exclusive)`;
  }
  return (
    validateNode(node.first, `${path}.first`, profiles) ??
    validateNode(node.second, `${path}.second`, profiles)
  );
}

function countFocusedTabs(node: LayoutNodeConfig): number {
  if (node.kind === "tile") return node.tabs.filter((tab) => tab.focus).length;
  return countFocusedTabs(node.first) + countFocusedTabs(node.second);
}

/** 検証のみ行い、ワークスペースには一切触れない。エラーメッセージ、問題なければnullを返す */
export function validateLayoutPreset(
  preset: LayoutPreset,
  profiles: ShellProfile[],
): string | null {
  const structuralError = validateNode(preset.layout, "layout", profiles);
  if (structuralError) return structuralError;
  if (countFocusedTabs(preset.layout) > 1) {
    return "at most 1 tab may set focus:true";
  }
  return null;
}

// ---- 組み立て ----

interface BuildContext {
  workspaceManager: WorkspaceManager;
  profiles: ShellProfile[];
  workspaceId: WorkspaceId;
  focusTarget: { tileId: TileId; tabId: TabId } | null;
}

/** tileIdが現時点で唯一持つタブのtabIdを返す（不変条件により常に1件のはず） */
function getSoleTabId(ctx: BuildContext, tileId: TileId): TabId {
  const entry = ctx.workspaceManager
    .listWorkspaces()
    .find((w) => w.workspaceId === ctx.workspaceId);
  const node = entry && findNode(entry.layout, tileId);
  if (!node || node.kind !== "leaf" || node.tabIds.length !== 1) {
    throw new Error(`internal error: expected tile ${tileId} to have exactly 1 tab`);
  }
  return node.tabIds[0] as TabId;
}

function buildTile(ctx: BuildContext, tileId: TileId, node: LayoutTileConfig): void {
  const placeholderTabId = getSoleTabId(ctx, tileId);
  const tabIds: TabId[] = [];

  for (const tabConfig of node.tabs) {
    tabIds.push(createTab(ctx, tileId, tabConfig));
  }

  if (!ctx.workspaceManager.closeTab(tileId, placeholderTabId)) {
    throw new Error(`internal error: failed to close placeholder tab in tile ${tileId}`);
  }

  const activeIndex = node.activeTab ?? tabIds.length - 1;
  const activeTabId = tabIds[activeIndex];
  if (activeTabId !== undefined) ctx.workspaceManager.switchTab(tileId, activeTabId);
}

function createTab(ctx: BuildContext, tileId: TileId, tabConfig: LayoutTabConfig): TabId {
  const resolved = resolveShellProfileCommand(ctx.profiles, tabConfig.shellProfile);
  const shellOverride = resolved.ok ? resolved.command : undefined;
  const tabId = ctx.workspaceManager.newTab(tileId, shellOverride, tabConfig.cwd);
  if (!tabId) throw new Error(`internal error: failed to create tab in tile ${tileId}`);

  if (tabConfig.name) ctx.workspaceManager.setTabName(tabId, tabConfig.name);

  if (tabConfig.vars) {
    for (const [key, value] of Object.entries(tabConfig.vars)) {
      ctx.workspaceManager.setTabVar(tabId, key, value);
    }
  }

  if (tabConfig.command) {
    const bytes = tmuxKeysToBytes([tabConfig.command, "Enter"]);
    const delay = tabConfig.delay ?? 0;
    if (delay > 0) {
      setTimeout(() => ctx.workspaceManager.handleInput(tabId, bytes), delay);
    } else {
      ctx.workspaceManager.handleInput(tabId, bytes);
    }
  }

  if (tabConfig.focus) ctx.focusTarget = { tileId, tabId };

  return tabId;
}

function buildNode(ctx: BuildContext, tileId: TileId, node: LayoutNodeConfig): void {
  if (node.kind === "tile") {
    buildTile(ctx, tileId, node);
    return;
  }
  const result = ctx.workspaceManager.splitTile(tileId, node.orientation, node.ratio);
  if (!result) throw new Error(`internal error: failed to split tile ${tileId}`);
  // splitTileはfirst=既存(tileIdのまま)/second=新規(result.tileId)で分割する（tile-layout.ts参照）
  buildNode(ctx, tileId, node.first);
  buildNode(ctx, result.tileId, node.second);
}

/** targetのワークスペースを、単一タイル・単一タブへ畳む（既存のcloseTabの繰り返しのみで実現する） */
function resetToSingleTile(workspaceManager: WorkspaceManager, workspaceId: WorkspaceId): void {
  for (;;) {
    const entry = workspaceManager.listWorkspaces().find((w) => w.workspaceId === workspaceId);
    if (!entry) return;
    const leaves = listLeaves(entry.layout);
    const [firstLeaf] = leaves;
    if (!firstLeaf) return;
    if (leaves.length === 1 && firstLeaf.tabIds.length === 1) return;
    if (leaves.length > 1) {
      const leaf = leaves[leaves.length - 1] as (typeof leaves)[number];
      for (const tabId of leaf.tabIds) workspaceManager.closeTab(leaf.id, tabId);
    } else {
      for (const tabId of firstLeaf.tabIds.slice(1)) {
        workspaceManager.closeTab(firstLeaf.id, tabId);
      }
    }
  }
}

function getRootTileId(workspaceManager: WorkspaceManager, workspaceId: WorkspaceId): TileId {
  const entry = workspaceManager.listWorkspaces().find((w) => w.workspaceId === workspaceId);
  if (!entry) throw new Error(`internal error: workspace not found: ${workspaceId}`);
  return entry.layout.id;
}

/**
 * レイアウトプリセットをワークスペースへ適用する。
 * target: "new-workspace"は新規ワークスペースとして適用（デフォルト、既存作業を壊さない安全側）、
 * "replace"は現在のワークスペースを単一タイルへ畳んでから適用する
 * （既存タブ・PTYは無条件でcloseする。確認プロンプト等の要否はroadmap「プロセスはどうなるのか」で別途検討）。
 * 検証エラー時はワークスペースに一切触れずエラーを返す。組み立て中の内部エラー（通常発生しない）も
 * ok:falseで返すが、その時点までに行った操作はロールバックされない
 */
export function applyLayoutPreset(
  workspaceManager: WorkspaceManager,
  profiles: ShellProfile[],
  preset: LayoutPreset,
  target: ApplyLayoutTarget,
): ApplyLayoutResult {
  const validationError = validateLayoutPreset(preset, profiles);
  if (validationError) return { ok: false, error: validationError };

  const workspaceId =
    target === "new-workspace"
      ? workspaceManager.newWorkspace()
      : workspaceManager.snapshot().activeWorkspaceId;

  if (target === "replace") {
    resetToSingleTile(workspaceManager, workspaceId);
  }

  const ctx: BuildContext = { workspaceManager, profiles, workspaceId, focusTarget: null };
  try {
    buildNode(ctx, getRootTileId(workspaceManager, workspaceId), preset.layout);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (ctx.focusTarget) {
    workspaceManager.focusTile(ctx.focusTarget.tileId);
    workspaceManager.switchTab(ctx.focusTarget.tileId, ctx.focusTarget.tabId);
  }

  return { ok: true, workspaceId };
}
