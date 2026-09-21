import { failAndExit } from "../cli-error";
import {
  applyLayout,
  type IpcEndpoint,
  listWorkspaces,
  newBoard,
  renameBoard,
  sendKeys,
  switchBoard,
  switchWorkspace,
  toAppAccessiblePath,
} from "../ipc-client";
import { createTargetResolver } from "../resolve-target";
import type { WorktreeOpenMode } from "./config";
import type { ProjectTrustDecision } from "./trust";

/**
 * `cd`へ渡すパスを引用する。POSIXシェルもPowerShellもシングルクォート文字列を解釈するため`'`で包む。
 * 内部の`'`の閉じ直し方はPOSIX式（`'\''`）で、`'`を含むパスをPowerShellのタブへ送ると崩れるが、
 * 引用せずに空白入りパスを送るほうが壊れる範囲が広いのでこちらを採る
 */
function shellQuotePath(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

interface FoundBoard {
  boardId: string;
  workspaceId: string;
  /** そのBoardが属するワークスペースが今アクティブかどうか */
  workspaceActive: boolean;
}

/**
 * そのワークツリーのBoardが既に開いていないか探す。Board作成時に記録したworktreePathが判定キーで、
 * タブのcwdは見ない（cdで変わるため）。同じパスのBoardが複数ある場合は最初の1つを返す
 */
async function findOpenBoard(endpoint: IpcEndpoint, appPath: string): Promise<FoundBoard | null> {
  const list = await listWorkspaces(endpoint);
  if (!list.ok) return null;
  for (const workspace of list.workspaces) {
    for (const board of workspace.boards) {
      if (board.worktreePath === appPath) {
        return {
          boardId: board.boardId,
          workspaceId: workspace.workspaceId,
          workspaceActive: workspace.active,
        };
      }
    }
  }
  return null;
}

/**
 * 適用するレイアウトプリセット名を決める。プロジェクトローカル設定を持つリポジトリが未承認なら、
 * プリセット名が明示指定であってもレイアウト指定自体を断る。
 * プリセットの解決はアプリ側が`<repoRoot>/.niwaterm/config.ts`を評価して行うため、
 * 未承認のまま名前を渡すと承認していないコードがそこで走るため
 */
export function resolveWorktreeLayout(opts: {
  commandName: string;
  /** `--layout`で明示指定された名前 */
  explicit: string | undefined;
  /** 設定（worktree.layout）から解決した既定値 */
  configured: string | undefined;
  trust: ProjectTrustDecision;
}): string | undefined {
  const name = opts.explicit ?? opts.configured;
  if (name === undefined) return undefined;
  if (opts.trust === "declined") {
    failAndExit(
      `${opts.commandName}に失敗しました: プロジェクトローカル設定が未承認のためレイアウトを適用できません。` +
        "プリセットの解決でそのリポジトリの設定が評価されるためです（--trustで承認できます）",
    );
  }
  return name;
}

export interface WorktreeLayoutRequest {
  /** `--layout`で明示指定された名前。Boardを作らなかったときに効いていない旨を伝えるために使う */
  explicit?: string;
  /**
   * 適用するプリセット名を返す。**Boardを新規に作るときだけ**呼ばれる。
   * 設定から既定値を読むにはプロジェクトローカル設定の承認が要るため、承認が要る場面でだけ
   * 呼べるよう関数で受ける（Boardを使い回すだけのときに確認を出さない）
   */
  resolve: () => Promise<string | undefined>;
}

export interface OpenWorktreeOptions {
  endpoint: IpcEndpoint;
  /** エラー文言に使うフルコマンド名（"worktree new" / "worktree open"） */
  commandName: string;
  mode: WorktreeOpenMode;
  /** メインワークツリーの絶対パス。レイアウトプリセットの解決起点になる */
  repoRoot: string;
  /** 開くワークツリーの絶対パス */
  path: string;
  /** Board名に使うブランチ名。detached HEADのワークツリーはnull */
  branch: string | null;
  /** Boardの作成先。省略時はアクティブなワークスペース */
  workspaceId?: string;
  layout?: WorktreeLayoutRequest;
}

/** レイアウトを適用しなかったときに、なぜ効いていないのかを伝える。reasonは「〜ため」までの理由句 */
function warnLayoutIgnored(layout: WorktreeLayoutRequest | undefined, reason: string): void {
  if (layout?.explicit === undefined) return;
  console.error(`warning: ${reason}--layoutは適用されません`);
}

/**
 * ワークツリーをniwatermで開く。`worktree new`と`worktree open`で共有する。
 * board系のモードでは既にそのワークツリーのBoardがあればそれを使い回し、同じワークツリーの
 * Boardが増えないようにする
 */
export async function openWorktree(opts: OpenWorktreeOptions): Promise<void> {
  const { endpoint, commandName, mode, path, branch, layout } = opts;
  if (mode === "none") {
    warnLayoutIgnored(layout, "--open noneのため");
    return;
  }

  if (mode === "current-tab") {
    warnLayoutIgnored(layout, "--open current-tabのため");
    const target = createTargetResolver(endpoint, commandName, {});
    // シェルは実行中のこのCLIが終わるまで入力を読まないため、キーはtty側で待たされてから流れる
    const result = await sendKeys(endpoint, await target.tabId(), [
      `cd ${shellQuotePath(path)}`,
      "Enter",
    ]);
    if (!result.ok) failAndExit(`${commandName}に失敗しました: ${result.error}`);
    return;
  }

  const appPath = toAppAccessiblePath(endpoint, path);
  const found = await findOpenBoard(endpoint, appPath);
  if (found) {
    // レイアウト適用は既存タブ・PTYを閉じる破壊的操作なので、作業中のBoardには当てない
    warnLayoutIgnored(layout, "Boardが既に開いているため");
    if (opts.workspaceId !== undefined && opts.workspaceId !== found.workspaceId) {
      console.error("warning: 既に開いているBoardを使うため--workspaceは使われません");
    }
    if (mode === "board-switch") {
      // switchBoardは所属ワークスペース内のアクティブBoardを変えるだけなので、
      // 別ワークスペースのBoardは先にワークスペースごと切り替えないと画面に出ない
      if (!found.workspaceActive) {
        const switched = await switchWorkspace(endpoint, found.workspaceId);
        if (!switched.ok) failAndExit(`${commandName}に失敗しました: ${switched.error}`);
      }
      const switched = await switchBoard(endpoint, found.boardId);
      if (!switched.ok) failAndExit(`${commandName}に失敗しました: ${switched.error}`);
    }
    console.log(`board: ${found.boardId}`);
    return;
  }

  const preset = await layout?.resolve();

  const created = await newBoard(endpoint, {
    ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
    cwd: path,
    activate: mode === "board-switch",
    worktreePath: path,
  });
  if (!created.ok) failAndExit(`${commandName}に失敗しました: ${created.error}`);
  // 遷移しないモードではサイドバーの見分けが唯一の手がかりになるため、必ずブランチ名を付ける
  if (branch !== null) {
    const renamed = await renameBoard(endpoint, created.boardId, branch);
    if (!renamed.ok) console.error(`warning: Board名を設定できませんでした: ${renamed.error}`);
  }

  if (preset !== undefined) {
    // 作りたてのBoardは単一タイル・単一タブなので、replaceで閉じるものが無い。
    // プリセットはメインワークツリーの.niwaterm/から引き（worktree.*の設定と同じ解決起点）、
    // タブはそのワークツリーで開く。リンクされたワークツリーへ.niwaterm/をコミットしていなくても
    // プロジェクトローカルのプリセットが引けるよう、解決起点と開く場所を分けている
    const applied = await applyLayout(endpoint, preset, {
      target: "replace",
      boardId: created.boardId,
      cwd: opts.repoRoot,
      tabCwd: path,
    });
    if (!applied.ok) {
      failAndExit(
        `${commandName}に失敗しました: レイアウト"${preset}"を適用できませんでした: ${applied.error}\n` +
          `Board ${created.boardId} は作成済みです`,
      );
    }
  }
  console.log(`board: ${created.boardId}`);
}
