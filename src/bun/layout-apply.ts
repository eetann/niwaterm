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
import type { BoardId } from "./board";
import { resolveShellProfileCommand } from "./shell-profiles";
import { findNode, listLeaves, type TabId, type TileId } from "./tile-layout";
import { tmuxKeysToBytes } from "./tmux-keys";
import type { WorkspaceManager } from "./workspace-manager";

export type ApplyLayoutTarget = "new-board" | "replace";

export type ApplyLayoutResult = { ok: true; boardId: BoardId } | { ok: false; error: string };

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
  boardId: BoardId;
  focusTarget: { tileId: TileId; tabId: TabId } | null;
  /** `niwaterm layout apply`を実行したCLIのcwd。tabConfig.cwd未指定時のデフォルトに使う */
  invocationCwd?: string;
}

/** 全Workspaceを横断してboardIdのBoardListEntryを探す（Board 1つはたかだか数十件程度のため線形探索で十分） */
function findBoardEntry(workspaceManager: WorkspaceManager, boardId: BoardId) {
  for (const entry of workspaceManager.listWorkspaces()) {
    const board = entry.boards.find((b) => b.boardId === boardId);
    if (board) return board;
  }
  return undefined;
}

/** tileIdが現時点で唯一持つタブのtabIdを返す（不変条件により常に1件のはず） */
function getSoleTabId(ctx: BuildContext, tileId: TileId): TabId {
  const board = findBoardEntry(ctx.workspaceManager, ctx.boardId);
  const node = board && findNode(board.layout, tileId);
  if (!node || node.kind !== "leaf" || node.tabIds.length !== 1) {
    throw new Error(`internal error: expected tile ${tileId} to have exactly 1 tab`);
  }
  return node.tabIds[0] as TabId;
}

// プレースホルダータブは既定シェル・invocationCwd（buildNode内のsplitTile呼び出しで
// 既に渡している）で生成済みのPTYを持つ。tabConfigがshellProfile/cwdを指定していなければ
// 結果は同一になるため、newTab+closeTabで新規PTYを作って即座に古いPTYを破棄する
// （Windows実機でネイティブ層のクラッシュを誘発した。layout-apply-crush.log参照）代わりに、
// プレースホルダーをそのまま最初のタブとして使い回す
function canReusePlaceholder(tabConfig: LayoutTabConfig): boolean {
  return tabConfig.shellProfile === undefined && tabConfig.cwd === undefined;
}

function configureTab(
  ctx: BuildContext,
  tileId: TileId,
  tabId: TabId,
  tabConfig: LayoutTabConfig,
): void {
  if (tabConfig.name) ctx.workspaceManager.setTabName(tabId, tabConfig.name);

  if (tabConfig.vars) {
    for (const [key, value] of Object.entries(tabConfig.vars)) {
      ctx.workspaceManager.setTabVar(tabId, key, value);
    }
  }

  if (tabConfig.command) {
    const bytes = tmuxKeysToBytes([tabConfig.command, "Enter"]);
    const delay = tabConfig.delay ?? 0;
    // handleInputではなくsendInitialInputを使う: 分割で作ったタイルのタブはPTY起動が
    // 実測cols/rows到達まで保留されており（TASK-0047）、handleInputだと黙って捨てられる
    if (delay > 0) {
      setTimeout(() => ctx.workspaceManager.sendInitialInput(tabId, bytes), delay);
    } else {
      ctx.workspaceManager.sendInitialInput(tabId, bytes);
    }
  }

  if (tabConfig.focus) ctx.focusTarget = { tileId, tabId };
}

function buildTile(ctx: BuildContext, tileId: TileId, node: LayoutTileConfig): void {
  const placeholderTabId = getSoleTabId(ctx, tileId);
  const tabIds: TabId[] = [];
  let placeholderReused = false;

  for (const [i, tabConfig] of node.tabs.entries()) {
    if (i === 0 && canReusePlaceholder(tabConfig)) {
      configureTab(ctx, tileId, placeholderTabId, tabConfig);
      tabIds.push(placeholderTabId);
      placeholderReused = true;
    } else {
      tabIds.push(createTab(ctx, tileId, tabConfig));
    }
  }

  if (!placeholderReused && !ctx.workspaceManager.closeTab(tileId, placeholderTabId)) {
    throw new Error(`internal error: failed to close placeholder tab in tile ${tileId}`);
  }

  const activeIndex = node.activeTab ?? tabIds.length - 1;
  const activeTabId = tabIds[activeIndex];
  if (activeTabId !== undefined) ctx.workspaceManager.switchTab(tileId, activeTabId);
}

function createTab(ctx: BuildContext, tileId: TileId, tabConfig: LayoutTabConfig): TabId {
  const resolved = resolveShellProfileCommand(ctx.profiles, tabConfig.shellProfile);
  const shellOverride = resolved.ok ? resolved.command : undefined;
  const tabId = ctx.workspaceManager.newTab(
    tileId,
    shellOverride,
    tabConfig.cwd ?? ctx.invocationCwd,
  );
  if (!tabId) throw new Error(`internal error: failed to create tab in tile ${tileId}`);
  configureTab(ctx, tileId, tabId, tabConfig);
  return tabId;
}

function buildNode(ctx: BuildContext, tileId: TileId, node: LayoutNodeConfig): void {
  if (node.kind === "tile") {
    buildTile(ctx, tileId, node);
    return;
  }
  const result = ctx.workspaceManager.splitTile(
    tileId,
    node.orientation,
    node.ratio,
    ctx.invocationCwd,
  );
  if (!result) throw new Error(`internal error: failed to split tile ${tileId}`);
  // splitTileはfirst=既存(tileIdのまま)/second=新規(result.tileId)で分割する（tile-layout.ts参照）
  buildNode(ctx, tileId, node.first);
  buildNode(ctx, result.tileId, node.second);
}

/** boardIdのBoardを、単一タイル・単一タブへ畳む（既存のcloseTabの繰り返しのみで実現する） */
function resetToSingleTile(workspaceManager: WorkspaceManager, boardId: BoardId): void {
  for (;;) {
    const board = findBoardEntry(workspaceManager, boardId);
    if (!board) return;
    const leaves = listLeaves(board.layout);
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

function getRootTileId(workspaceManager: WorkspaceManager, boardId: BoardId): TileId {
  const board = findBoardEntry(workspaceManager, boardId);
  if (!board) throw new Error(`internal error: board not found: ${boardId}`);
  return board.layout.id;
}

/**
 * レイアウトプリセットをBoardへ適用する（ADR 0006、Board単位のapply）。
 * target: "new-board"は指定Boardへそのまま組み立てる（デフォルト、既存作業を壊さない安全側。
 * どのWorkspaceへ新規Boardを作るかは呼び出し側でboardIdを解決してから渡す）、
 * "replace"は指定Boardを単一タイルへ畳んでから適用する
 * （既存タブ・PTYは無条件でcloseする。確認プロンプト等の要否はroadmap「プロセスはどうなるのか」で別途検討）。
 * 検証エラー時はBoardに一切触れずエラーを返す。組み立て中の内部エラー（通常発生しない）も
 * ok:falseで返すが、その時点までに行った操作はロールバックされない。
 * invocationCwdは`niwaterm layout apply`を実行したCLIのcwdで、tabConfig.cwd未指定時のデフォルトになる
 * （"replace"時、それ以上分割されないまま最初に到達するタイルだけは既存タブを使い回すため、
 * このデフォルトが効かず元のcwdのまま残る点に注意）
 */
export function applyLayoutPreset(
  workspaceManager: WorkspaceManager,
  profiles: ShellProfile[],
  preset: LayoutPreset,
  target: ApplyLayoutTarget,
  boardId: BoardId,
  invocationCwd?: string,
): ApplyLayoutResult {
  const validationError = validateLayoutPreset(preset, profiles);
  if (validationError) return { ok: false, error: validationError };

  if (target === "replace") {
    resetToSingleTile(workspaceManager, boardId);
  }

  const ctx: BuildContext = {
    workspaceManager,
    profiles,
    boardId,
    focusTarget: null,
    invocationCwd,
  };
  try {
    buildNode(ctx, getRootTileId(workspaceManager, boardId), preset.layout);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (ctx.focusTarget) {
    workspaceManager.focusTile(ctx.focusTarget.tileId);
    workspaceManager.switchTab(ctx.focusTarget.tileId, ctx.focusTarget.tabId);
  }

  return { ok: true, boardId };
}
