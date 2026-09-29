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
  type TileSummary,
  toAppAccessiblePath,
} from "../ipc-client";
import { confirmTrust } from "../layout-trust";
import { createTargetResolver } from "../resolve-target";
import { findWorktreeBoards, type WorktreeBoard } from "./board";
import type { WorktreeOpenHook, WorktreeOpenMode } from "./config";
import type { ProjectTrustDecision } from "./trust";

/**
 * `cd`へ渡すパスを引用する。POSIXシェルもPowerShellもシングルクォート文字列を解釈するため`'`で包む。
 * 内部の`'`の閉じ直し方はPOSIX式（`'\''`）で、`'`を含むパスをPowerShellのタブへ送ると崩れるが、
 * 引用せずに空白入りパスを送るほうが壊れる範囲が広いのでこちらを採る
 */
function shellQuotePath(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

/**
 * そのワークツリーのBoardが既に開いていないか探す。同じパスのBoardが複数ある場合は最初の1つ。
 * アプリへ繋がらない場合は「開いていない」として扱い、続くBoard作成で接続エラーを出させる
 */
async function findOpenBoard(
  endpoint: IpcEndpoint,
  appPath: string,
): Promise<WorktreeBoard | null> {
  const found = await findWorktreeBoards(endpoint, appPath);
  return found.ok ? (found.boards[0] ?? null) : null;
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

/** WorktreeBoardSetupRequest.resolveの結果 */
export interface ResolvedWorktreeBoardSetup {
  /** 適用するプリセット名。undefinedならレイアウトを適用しない */
  preset?: string;
  /**
   * プロジェクトローカル設定を承認済みか。起動時レイアウトの紐づけへの同意として引き継ぐ。
   * ワークツリーの承認プロンプトが「プリセットのcommandが起動のたびに実行される」ところまで
   * 含めて聞いているため、同じリポジトリのプリセットを紐づけるのに再度確認は取らない
   */
  trusted: boolean;
  /** Boardを作った後に走らせるフック（worktree.onOpen）。実行順に並ぶ */
  onOpen: WorktreeOpenHook[];
}

export interface WorktreeBoardSetupRequest {
  /** `--layout`で明示指定された名前。Boardを作らなかったときに効いていない旨を伝えるために使う */
  explicitLayout?: string;
  /**
   * 適用するプリセットとBoardを作った後のフックを返す。**Boardを新規に作るときだけ**呼ばれる。
   * 設定から既定値を読むにはプロジェクトローカル設定の承認が要るため、承認が要る場面でだけ
   * 呼べるよう関数で受ける（Boardを使い回すだけのときに確認を出さない）
   */
  resolve: () => Promise<ResolvedWorktreeBoardSetup>;
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
  /** 今回ワークツリーを新規作成したか。onOpenのフックへそのまま渡す */
  created: boolean;
  /** Boardの作成先。省略時はアクティブなワークスペース */
  workspaceId?: string;
  /** `--name`で明示指定されたBoard名。省略時はブランチ名をBoard名にする */
  name?: string;
  boardSetup?: WorktreeBoardSetupRequest;
}

/** Boardを作らなかったときに、なぜ効いていないのかを伝える。reasonは「〜ため」までの理由句 */
function warnOptionsIgnored(reason: string, names: string[]): void {
  if (names.length === 0) return;
  console.error(`warning: ${reason}${names.join("・")}は使われません`);
}

/** Boardを新規に作るときだけ効くオプションのうち、明示指定されたものを並べる */
function boardOnlyOptions(opts: OpenWorktreeOptions): string[] {
  return [
    ...(opts.boardSetup?.explicitLayout !== undefined ? ["--layout"] : []),
    ...(opts.name !== undefined ? ["--name"] : []),
  ];
}

function collectTabIds(tile: TileSummary): string[] {
  return tile.kind === "leaf"
    ? [...tile.tabIds]
    : [...collectTabIds(tile.first), ...collectTabIds(tile.second)];
}

interface RunOpenHooksOptions {
  endpoint: IpcEndpoint;
  commandName: string;
  boardId: string;
  context: { repoRoot: string; worktreePath: string; branch: string | null; created: boolean };
}

/**
 * Boardを作った後のフック（worktree.onOpen）を順に実行する。タブIDはレイアウトの適用で
 * 入れ替わるため、適用後に一覧から引き直す。
 * 失敗してもBoardは閉じない。作業できる状態のBoardを捨てるより、足りない操作を手で補えるほうがよいため
 */
async function runOpenHooks(hooks: WorktreeOpenHook[], opts: RunOpenHooksOptions): Promise<void> {
  if (hooks.length === 0) return;
  const boardNote = `Board ${opts.boardId} は作成済みです`;
  const list = await listWorkspaces(opts.endpoint);
  if (!list.ok) {
    failAndExit(
      `${opts.commandName}に失敗しました: Boardを開いた後のフックに渡すタブを取得できませんでした: ${list.error}\n${boardNote}`,
    );
  }
  let target: { workspaceId: string; tabIds: string[] } | null = null;
  for (const workspace of list.workspaces) {
    const board = workspace.boards.find((entry) => entry.boardId === opts.boardId);
    if (board) {
      target = { workspaceId: workspace.workspaceId, tabIds: collectTabIds(board.layout) };
      break;
    }
  }
  if (!target) {
    failAndExit(
      `${opts.commandName}に失敗しました: Boardを開いた後のフックを実行する前にBoardが閉じられました: ${opts.boardId}`,
    );
  }

  console.log(`running worktree open hook (${hooks.length})...`);
  for (const hook of hooks) {
    try {
      await hook({
        ...opts.context,
        workspaceId: target.workspaceId,
        boardId: opts.boardId,
        // 前のフックが配列を書き換えても次のフックへ波及しないよう、毎回複製して渡す
        tabIds: [...target.tabIds],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failAndExit(
        `${opts.commandName}に失敗しました: Boardを開いた後のフックが失敗しました: ${message}\n${boardNote}`,
      );
    }
  }
}

/**
 * ワークツリーをniwatermで開く。`worktree new`と`worktree open`で共有する。
 * board系のモードでは既にそのワークツリーのBoardがあればそれを使い回し、同じワークツリーの
 * Boardが増えないようにする
 */
export async function openWorktree(opts: OpenWorktreeOptions): Promise<void> {
  const { endpoint, commandName, mode, path, branch, boardSetup } = opts;
  if (mode === "none") {
    warnOptionsIgnored("--open noneのため", boardOnlyOptions(opts));
    return;
  }

  if (mode === "current-tab") {
    warnOptionsIgnored("--open current-tabのため", boardOnlyOptions(opts));
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
    // レイアウト適用は既存タブ・PTYを閉じる破壊的操作なので、作業中のBoardには当てない。
    // 名前の変更は非破壊なので、明示指定されていれば使い回すBoardへも反映する
    warnOptionsIgnored(
      "Boardが既に開いているため",
      boardSetup?.explicitLayout !== undefined ? ["--layout"] : [],
    );
    if (opts.name !== undefined) {
      const renamed = await renameBoard(endpoint, found.boardId, opts.name);
      if (!renamed.ok) console.error(`warning: Board名を設定できませんでした: ${renamed.error}`);
    }
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

  const setup = await boardSetup?.resolve();
  const preset = setup?.preset;

  // 遷移しないモードではサイドバーの見分けが唯一の手がかりになるため、
  // 名前の指定が無ければブランチ名を付ける
  const boardName = opts.name ?? branch;
  const created = await newBoard(endpoint, {
    ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
    cwd: path,
    activate: mode === "board-switch",
    worktreePath: path,
    ...(boardName !== null ? { name: boardName } : {}),
  });
  if (!created.ok) failAndExit(`${commandName}に失敗しました: ${created.error}`);

  if (preset !== undefined) {
    // 作りたてのBoardは単一タイル・単一タブなので、replaceで閉じるものが無い。
    // プリセットはメインワークツリーの.niwaterm/から引き（worktree.*の設定と同じ解決起点）、
    // タブはそのワークツリーで開く。リンクされたワークツリーへ.niwaterm/をコミットしていなくても
    // プロジェクトローカルのプリセットが引けるよう、解決起点と開く場所を分けている
    const applyOnce = (startup: boolean, trust: boolean) =>
      applyLayout(endpoint, preset, {
        target: "replace",
        boardId: created.boardId,
        cwd: opts.repoRoot,
        tabCwd: path,
        startup,
        trust,
      });
    // 起動時レイアウトとしても紐づける。Boardの中身をプリセットが決めているので、
    // 次の起動でも保存した骨格ではなくプリセットで組み直すほうが指定どおりになる
    let applied = await applyOnce(true, setup?.trusted === true);
    if (!applied.ok && "needsTrust" in applied) {
      // プリセットの解決元がこのリポジトリの外（親ディレクトリの.niwaterm/等）だと、
      // ワークツリーの承認では足りない。改めて同意を取り、断られたら紐づけだけ諦める
      // （今回の適用はワークツリーの承認で済んでいるので続ける）
      if (await confirmTrust(applied.needsTrust)) {
        applied = await applyOnce(true, true);
      } else {
        console.error("warning: 起動時レイアウトには紐づけません（今回の適用のみ）");
        applied = await applyOnce(false, false);
      }
    }
    if (!applied.ok) {
      failAndExit(
        `${commandName}に失敗しました: レイアウト"${preset}"を適用できませんでした: ${applied.error}\n` +
          `Board ${created.boardId} は作成済みです`,
      );
    }
  }
  console.log(`board: ${created.boardId}`);

  await runOpenHooks(setup?.onOpen ?? [], {
    endpoint,
    commandName,
    boardId: created.boardId,
    context: { repoRoot: opts.repoRoot, worktreePath: path, branch, created: opts.created },
  });
}
