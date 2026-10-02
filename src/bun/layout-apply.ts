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
import type { BuiltinLayoutName } from "./builtin-layouts";
import { resolveTabCwd } from "./project-config";
import {
  type BoardResumeOverride,
  decideResumeCommand,
  isLayoutTabResumeEnabled,
} from "./resume-command";
import { resolveShellProfileCommand } from "./shell-profiles";
import { findNode, listLeaves, type TabId, type TileId } from "./tile-layout";
import type { WorkspaceManager } from "./workspace-manager";

export type ApplyLayoutTarget = "new-board" | "replace";

/** applyLayoutPresetのcwd解決に関わるオプション */
export interface ApplyLayoutOptions {
  /** `niwa layout apply`を実行したCLIのcwd。プロジェクトローカル由来でないときのcwd基準になる */
  invocationCwd?: string;
  /**
   * プロジェクトローカル（<projectRoot>/.niwaterm/config.ts）由来のプリセットならその解決元。
   * 指定するとinvocationCwdより優先してcwdの基準になり、tabConfig.cwdの相対パスもここから解決される
   */
  projectRoot?: string;
  /**
   * タブのcwdの基準を明示する。指定するとprojectRoot・invocationCwdのどちらより優先される。
   *
   * ワークツリーのBoard向け。プリセットはメインワークツリーの`.niwaterm/`から引きつつ、
   * タブはそのワークツリーで開く必要があり、「解決元」と「開く場所」が別になるため
   */
  tabBaseCwd?: string;
  /** 起動時に組み直すとき、前回の終了時に実行中だったコマンドを引き継ぐための情報 */
  resume?: LayoutResumeContext;
}

export interface LayoutResumeContext {
  /** 前回の終了時に実行中だったコマンド。キーはタブのlayoutSlot（slotPath） */
  commands: Record<string, string>;
  /** Boardの手動の切り替え。nullは設定（プリセット・タブのresume）に従う */
  override: BoardResumeOverride;
  /** 設定のresume.allow */
  allow: readonly string[];
}

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
  presetResume: boolean | undefined;
  resume: LayoutResumeContext | undefined;
  /**
   * tabConfig.cwd未指定時のデフォルトであり、相対cwdの解決基準。
   * プロジェクトローカル由来のプリセットならprojectRoot、そうでなければ
   * `niwa layout apply`を実行したCLIのcwd（ApplyLayoutOptionsで決まる）
   */
  baseCwd?: string;
}

/** tileIdが現時点で唯一持つタブのtabIdを返す（不変条件により常に1件のはず） */
function getSoleTabId(ctx: BuildContext, tileId: TileId): TabId {
  const board = ctx.workspaceManager.findBoard(ctx.boardId);
  const node = board && findNode(board.layout, tileId);
  if (!node || node.kind !== "leaf" || node.tabIds.length !== 1) {
    throw new Error(`internal error: expected tile ${tileId} to have exactly 1 tab`);
  }
  return node.tabIds[0] as TabId;
}

// プレースホルダータブは既定シェル・baseCwd（buildNode内のsplitTile呼び出しで
// 既に渡している）で生成済みのPTYを持つ。tabConfigがshellProfile/cwdを指定していなければ
// 結果は同一になるため、newTab+closeTabで新規PTYを作って即座に古いPTYを破棄する
// （Windowsではネイティブ層のクラッシュを誘発する）代わりに、
// プレースホルダーをそのまま最初のタブとして使い回す
function canReusePlaceholder(tabConfig: LayoutTabConfig): boolean {
  return tabConfig.shellProfile === undefined && tabConfig.cwd === undefined;
}

/**
 * 使い回すプレースホルダーのcwdをbaseCwdへ揃える。
 *
 * "replace"時のプレースホルダーは適用前のBoardに元からあったタブそのもので、PTYは以前のcwdの
 * まま動いている（ホームディレクトリのままになる等）。他のタブだけがbaseCwdで作られるため、
 * 最初のタイルの最初のタブだけcwdが揃わない、という食い違いが起きる。
 *
 * newTab+closeTabで作り直すのはWindowsでネイティブ層のクラッシュを誘発するため採れない
 * （canReusePlaceholderのコメント参照）。タブは維持したままPTYだけrespawnして揃える。
 * PTY起動保留中のタブ（"new-board"時・分割で作られたタイル）なら、respawnTab側の分岐で
 * 保留パラメータの上書きだけで済む。
 *
 * respawnTabは保留中タブへ積んだ初期コマンドを引き継がないため、必ずconfigureTab（commandの
 * sendInitialCommand）より前に呼ぶこと。
 */
function alignPlaceholderCwd(ctx: BuildContext, tabId: TabId): void {
  if (ctx.baseCwd === undefined) return;
  ctx.workspaceManager.respawnTab(tabId, undefined, ctx.baseCwd);
}

/**
 * プリセット内でのタブ定義の位置（例: "first.second.tabs.1"）。組み直したタブと前回のタブを
 * 対応付けるキーで、タブ名のようにユーザーが書き換えるものではなく構造から決まる値を使う
 */
function slotPath(nodePath: string, tabIndex: number): string {
  return `${nodePath}tabs.${tabIndex}`;
}

/** そのタブで前回実行中だったコマンドを、commandの代わりに打ち直すならそのコマンド */
function resumeCommandFor(
  ctx: BuildContext,
  slot: string,
  tabConfig: LayoutTabConfig,
): string | null {
  const resume = ctx.resume;
  const previous = resume?.commands[slot];
  if (resume === undefined || previous === undefined) return null;
  if (!isLayoutTabResumeEnabled(resume.override, tabConfig.resume, ctx.presetResume)) return null;
  const decision = decideResumeCommand(previous, resume.allow);
  return decision.ok ? decision.command : null;
}

function configureTab(
  ctx: BuildContext,
  tileId: TileId,
  tabId: TabId,
  tabConfig: LayoutTabConfig,
  slot: string,
): void {
  ctx.workspaceManager.setTabLayoutSlot(tabId, slot);
  if (tabConfig.name) ctx.workspaceManager.setTabName(tabId, tabConfig.name);

  if (tabConfig.vars) {
    for (const [key, value] of Object.entries(tabConfig.vars)) {
      ctx.workspaceManager.setTabVar(tabId, key, value);
    }
  }

  const resumed = resumeCommandFor(ctx, slot, tabConfig);
  if (resumed !== null) {
    const delay = tabConfig.delay ?? 0;
    if (delay > 0) {
      setTimeout(() => ctx.workspaceManager.sendResumeCommand(tabId, resumed), delay);
    } else {
      ctx.workspaceManager.sendResumeCommand(tabId, resumed);
    }
  } else if (tabConfig.command) {
    const command = tabConfig.command;
    const delay = tabConfig.delay ?? 0;
    // handleInputではなくsendInitialCommandを使う: 分割で作ったタイルのタブはPTY起動が
    // 実測cols/rows到達まで保留されており、handleInputだと黙って捨てられる
    if (delay > 0) {
      setTimeout(() => ctx.workspaceManager.sendInitialCommand(tabId, command), delay);
    } else {
      ctx.workspaceManager.sendInitialCommand(tabId, command);
    }
  }

  if (tabConfig.focus) ctx.focusTarget = { tileId, tabId };
}

function buildTile(
  ctx: BuildContext,
  tileId: TileId,
  node: LayoutTileConfig,
  nodePath: string,
): void {
  const placeholderTabId = getSoleTabId(ctx, tileId);
  const tabIds: TabId[] = [];
  let placeholderReused = false;

  for (const [i, tabConfig] of node.tabs.entries()) {
    const slot = slotPath(nodePath, i);
    if (i === 0 && canReusePlaceholder(tabConfig)) {
      alignPlaceholderCwd(ctx, placeholderTabId);
      configureTab(ctx, tileId, placeholderTabId, tabConfig, slot);
      tabIds.push(placeholderTabId);
      placeholderReused = true;
    } else {
      tabIds.push(createTab(ctx, tileId, tabConfig, slot));
    }
  }

  if (!placeholderReused && !ctx.workspaceManager.closeTab(tileId, placeholderTabId)) {
    throw new Error(`internal error: failed to close placeholder tab in tile ${tileId}`);
  }

  const activeIndex = node.activeTab ?? tabIds.length - 1;
  const activeTabId = tabIds[activeIndex];
  if (activeTabId !== undefined) ctx.workspaceManager.switchTab(tileId, activeTabId);
}

function createTab(
  ctx: BuildContext,
  tileId: TileId,
  tabConfig: LayoutTabConfig,
  slot: string,
): TabId {
  const resolved = resolveShellProfileCommand(ctx.profiles, tabConfig.shellProfile);
  const shellOverride = resolved.ok ? resolved.command : undefined;
  const tabId = ctx.workspaceManager.newTab(
    tileId,
    shellOverride,
    resolveTabCwd(tabConfig.cwd, ctx.baseCwd),
  );
  if (!tabId) throw new Error(`internal error: failed to create tab in tile ${tileId}`);
  configureTab(ctx, tileId, tabId, tabConfig, slot);
  return tabId;
}

function buildNode(
  ctx: BuildContext,
  tileId: TileId,
  node: LayoutNodeConfig,
  nodePath: string,
): void {
  if (node.kind === "tile") {
    buildTile(ctx, tileId, node, nodePath);
    return;
  }
  const result = ctx.workspaceManager.splitTile(tileId, node.orientation, node.ratio, ctx.baseCwd);
  if (!result) throw new Error(`internal error: failed to split tile ${tileId}`);
  // splitTileはfirst=既存(tileIdのまま)/second=新規(result.tileId)で分割する（tile-layout.ts参照）
  buildNode(ctx, tileId, node.first, `${nodePath}first.`);
  buildNode(ctx, result.tileId, node.second, `${nodePath}second.`);
}

/** boardIdのBoardを、単一タイル・単一タブへ畳む（既存のcloseTabの繰り返しのみで実現する） */
function resetToSingleTile(workspaceManager: WorkspaceManager, boardId: BoardId): void {
  for (;;) {
    const board = workspaceManager.findBoard(boardId);
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
  const board = workspaceManager.findBoard(boardId);
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
 * cwdの基準はoptionsで決まる（ApplyLayoutOptions参照）。"replace"時に使い回す既存タブも
 * alignPlaceholderCwdでbaseCwdへ揃えるため、タイル間でcwdが食い違うことはない
 */
export function applyLayoutPreset(
  workspaceManager: WorkspaceManager,
  profiles: ShellProfile[],
  preset: LayoutPreset,
  target: ApplyLayoutTarget,
  boardId: BoardId,
  options: ApplyLayoutOptions = {},
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
    presetResume: preset.resume,
    resume: options.resume,
    // プロジェクトローカル由来のプリセットはprojectRootを基準にする。リポジトリへコミットした
    // プリセットが「どこから実行されたか」に左右されず、同じ構成を再現できるようにするため。
    // tabBaseCwdはこれを打ち消す（開く場所が指定されているワークツリーのBoard向け）
    baseCwd: options.tabBaseCwd ?? options.projectRoot ?? options.invocationCwd,
  };
  try {
    buildNode(ctx, getRootTileId(workspaceManager, boardId), preset.layout, "");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (ctx.focusTarget) {
    workspaceManager.focusTile(ctx.focusTarget.tileId);
    workspaceManager.switchTab(ctx.focusTarget.tileId, ctx.focusTarget.tabId);
  }

  return { ok: true, boardId };
}

/**
 * ビルトインの"empty"を適用する（Boardをタイル1つ・タブ1つのまっさらな状態へ戻す）。
 *
 * 畳んで閉じたタブのPTYはcloseTabが始末するが、残す1タブだけは自前で起動し直す。
 * 「動いているプロセスを全部止める」のが目的なので、残ったタブでTUIが動き続けるのでは
 * 用を成さないため。引き継ぐのはそのタブのcwdだけで、タブ名・タイル名・タブ変数は消す。
 *
 * layoutsプリセットのapply（applyLayoutPreset）と違いbaseCwdを見ないのは、Boardを畳む操作で
 * 作業ディレクトリまで別の場所へ移されると「片付けたら知らない場所に立っていた」状態になるため。
 */
function applyEmptyLayout(workspaceManager: WorkspaceManager, boardId: BoardId): ApplyLayoutResult {
  if (!workspaceManager.findBoard(boardId)) {
    return { ok: false, error: `board not found: ${boardId}` };
  }
  resetToSingleTile(workspaceManager, boardId);

  const board = workspaceManager.findBoard(boardId);
  const leaf = board && listLeaves(board.layout)[0];
  if (!leaf || leaf.tabIds.length !== 1) {
    return { ok: false, error: `internal error: failed to reset board ${boardId}` };
  }
  const tileId = leaf.id;
  let tabId = leaf.tabIds[0] as TabId;

  if (workspaceManager.locateBrowserTab(tabId)) {
    // ブラウザタブはPTYを持たず起動し直せないので、terminalタブを足してから閉じる。
    // 先に足すのは、最後の1タブを閉じるとBoardごと畳まれてしまうため
    const replacement = workspaceManager.newTab(tileId);
    if (!replacement) {
      return { ok: false, error: `internal error: failed to create tab in tile ${tileId}` };
    }
    workspaceManager.closeTab(tileId, tabId);
    tabId = replacement;
  } else {
    // respawnTabはcwd省略時にタブ変数の"cwd"（OSC 7の報告値）を引き継ぎ元にするため、
    // 変数を消すより先に呼ぶ
    workspaceManager.respawnTab(tabId);
  }

  const cwd = workspaceManager.listTabVars(tabId)?.["cwd"];
  workspaceManager.clearTabVars(tabId);
  // 起動し直したシェルは同じディレクトリに居る。OSC 7を報告しないシェルでも
  // サイドバーの表示・以後のタブ追加時のcwd引き継ぎが欠けないよう戻しておく
  if (cwd !== undefined) workspaceManager.setTabVar(tabId, "cwd", cwd);
  workspaceManager.setTabName(tabId, "");
  workspaceManager.setTileName(tileId, "");

  return { ok: true, boardId };
}

/** ビルトインプリセット（builtin-layouts.ts）をBoardへ適用する */
export function applyBuiltinLayout(
  workspaceManager: WorkspaceManager,
  name: BuiltinLayoutName,
  boardId: BoardId,
): ApplyLayoutResult {
  switch (name) {
    case "empty":
      return applyEmptyLayout(workspaceManager, boardId);
  }
}
