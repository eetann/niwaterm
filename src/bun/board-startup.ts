// Boardへの起動時レイアウトの紐づけ（CLIの`board startup`とサイドバーの右クリックメニューの
// 共通処理）。
//
// プロジェクトローカル由来のプリセットを"layout"へ紐づける操作にはtrustの同意が要る。
// 紐づけると以後アプリ起動のたびにそのリポジトリの.niwaterm/config.tsが評価され、プリセットの
// commandが実行されるため（詳細: packages/cli/src/layout-trust.ts）。同意の取り方は入口ごとに
// 異なる（CLIはTTYのy/N、サイドバーはwebviewのモーダル）が、ゲート自体は入口が増えても
// 1箇所であり続けるようここへ集約する。

import type { LayoutsConfig, ShellProfile } from "@niwaterm/config";
import { applyLayoutPreset } from "./layout-apply";
import type { BoardRestoreMode, PersistedBoardStartup } from "./persistence";
import { loadProjectPreset, resolveLayoutPresetByName } from "./project-config";
import type { BoardId } from "./workspace";
import type { WorkspaceManager } from "./workspace-manager";

/** 紐づけの操作。"clear"は紐づけ自体の解除で、永続化されるBoardRestoreModeには載らない */
export type BoardStartupMode = BoardRestoreMode | "clear";

/** trustの同意が要る操作を拒否したときに、確認プロンプトを出す側へ渡す情報 */
export interface BoardStartupTrustRequest {
  projectRoot: string;
  preset: string;
}

/**
 * 起動時レイアウトへの紐づけにtrustの同意が要るかを判定する。同意が必要なら拒否用の応答を、
 * 不要（グローバル設定由来、または同意済み）ならnullを返す。
 *
 * 紐づけを作る経路（CLIの`layout apply --startup`／`board startup layout`、サイドバーの
 * 右クリックメニュー）はどれもここを通す。判定と文面が散らばると、入口が増えたときに
 * 片方だけ素通しになる事故が起きるため
 */
export function checkLayoutTrust(
  bindsStartup: boolean,
  projectRoot: string | null,
  trust: boolean | undefined,
  preset: string,
): { needsTrust: BoardStartupTrustRequest; error: string } | null {
  if (!bindsStartup || !projectRoot || trust) return null;
  return {
    needsTrust: { projectRoot, preset },
    error: `layout "${preset}" is defined in ${projectRoot}/.niwaterm/config.ts. Applying it at startup runs that repository's code and commands on every launch. Confirm interactively, or pass --trust if you trust it.`,
  };
}

export type ChangeBoardStartupResult =
  | { ok: true; boardId: BoardId; startup: PersistedBoardStartup | null }
  | {
      ok: false;
      error: string;
      /** HTTPで返す場合のステータス。trust待ちは失敗ではなく再送を促す応答なので付かない */
      status?: 400 | 404;
      needsTrust?: BoardStartupTrustRequest;
    };

/** changeBoardStartupが触るWorkspaceManagerの部分。テストから差し替えられるよう最小限に絞る */
export interface BoardStartupStore {
  hasBoard: (boardId: BoardId) => boolean;
  getBoardStartup: (boardId: BoardId) => PersistedBoardStartup | null;
  setBoardStartup: (boardId: BoardId, startup: PersistedBoardStartup | null) => boolean;
}

export interface ChangeBoardStartupInput {
  boardId: BoardId;
  mode: BoardStartupMode;
  /** 紐づけるプリセット名。省略時は既に紐づいているプリセットを解決元ごと引き継ぐ */
  preset?: string;
  /** presetの解決元（プロジェクトローカル）を探す起点ディレクトリ */
  cwd?: string;
  /** プロジェクトローカル由来のプリセットを"layout"へ紐づける同意が取れているか */
  trust?: boolean;
}

export async function changeBoardStartup(
  store: BoardStartupStore,
  layouts: LayoutsConfig,
  input: ChangeBoardStartupInput,
): Promise<ChangeBoardStartupResult> {
  const { boardId } = input;
  if (!store.hasBoard(boardId)) {
    return { ok: false, status: 404, error: `board not found: ${boardId}` };
  }
  if (input.mode === "clear") {
    store.setBoardStartup(boardId, null);
    return { ok: true, boardId, startup: null };
  }
  const existing = store.getBoardStartup(boardId);
  const preset = input.preset ?? existing?.preset;
  if (!preset) {
    return {
      ok: false,
      status: 400,
      error: `board ${boardId} has no layout preset; pass preset to associate one`,
    };
  }
  // presetを明示指定されたときだけ解決し直す。省略時は既存の紐づけ（解決元込み）を引き継ぎ、
  // 別ディレクトリからmodeだけ切り替えても解決元が入れ替わらないようにする
  let projectRoot: string | null;
  if (input.preset !== undefined) {
    const resolved = await resolveLayoutPresetByName(input.preset, input.cwd, layouts);
    if (!resolved) return { ok: false, status: 404, error: `layout not found: ${preset}` };
    projectRoot = resolved.projectRoot;
  } else {
    projectRoot = existing?.projectRoot ?? null;
    const stillExists = projectRoot
      ? (await loadProjectPreset(projectRoot, preset)) !== null
      : layouts[preset] !== undefined;
    if (!stillExists) return { ok: false, status: 404, error: `layout not found: ${preset}` };
  }
  const denied = checkLayoutTrust(input.mode === "layout", projectRoot, input.trust, preset);
  if (denied) return { ok: false, ...denied };
  const startup: PersistedBoardStartup = {
    preset,
    restoreMode: input.mode,
    ...(projectRoot ? { projectRoot } : {}),
  };
  store.setBoardStartup(boardId, startup);
  return { ok: true, boardId, startup };
}

export interface ApplyAndBindStartupLayoutInput {
  boardId: BoardId;
  /** 適用するプリセット名 */
  preset: string;
  /** presetの解決元（プロジェクトローカル）を探す起点ディレクトリ */
  cwd?: string;
  trust?: boolean;
}

export type ApplyAndBindStartupLayoutResult =
  | { ok: true; boardId: BoardId; startup: PersistedBoardStartup }
  | { ok: false; error: string; needsTrust?: BoardStartupTrustRequest };

/**
 * プリセットをBoardへ今すぐ適用し、同じプリセットを起動時レイアウトとしても紐づける
 * （CLIの`layout apply <name> --replace --startup --board <id>`と同じ）。
 *
 * サイドバーのメニューから選んだプリセットは、次回起動を待たずその場で見えた方が
 * 「思っていたレイアウトと違う」に早く気づける。適用は既存タブ・PTYを閉じる破壊的操作のため、
 * 呼び出し側で確認を取ってから呼ぶこと
 */
export async function applyAndBindStartupLayout(
  workspaceManager: WorkspaceManager,
  shellProfiles: ShellProfile[],
  layouts: LayoutsConfig,
  input: ApplyAndBindStartupLayoutInput,
): Promise<ApplyAndBindStartupLayoutResult> {
  if (!workspaceManager.hasBoard(input.boardId)) {
    return { ok: false, error: `board not found: ${input.boardId}` };
  }
  const resolved = await resolveLayoutPresetByName(input.preset, input.cwd, layouts);
  if (!resolved) return { ok: false, error: `layout not found: ${input.preset}` };
  const denied = checkLayoutTrust(true, resolved.projectRoot, input.trust, input.preset);
  if (denied) return { ok: false, ...denied };

  const applied = applyLayoutPreset(
    workspaceManager,
    shellProfiles,
    resolved.preset,
    "replace",
    input.boardId,
    {
      ...(input.cwd !== undefined ? { invocationCwd: input.cwd } : {}),
      ...(resolved.projectRoot ? { projectRoot: resolved.projectRoot } : {}),
    },
  );
  if (!applied.ok) return { ok: false, error: applied.error };

  const startup: PersistedBoardStartup = {
    preset: input.preset,
    restoreMode: "layout",
    ...(resolved.projectRoot ? { projectRoot: resolved.projectRoot } : {}),
  };
  workspaceManager.setBoardStartup(applied.boardId, startup);
  return { ok: true, boardId: applied.boardId, startup };
}
