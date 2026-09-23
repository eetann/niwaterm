import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import {
  closeBoard,
  type IpcEndpoint,
  resolveIpcEndpoint,
  resolveTarget,
  toAppAccessiblePath,
} from "../../ipc-client";
import { findWorktreeBoards, type WorktreeBoard } from "../../worktree/board";
import {
  deleteBranch,
  findWorktreeByQuery,
  listWorktrees,
  mainWorktree,
  removeWorktree,
  type WorktreeEntry,
} from "../../worktree/git";
import { inspectWorktree, isInsideWorktree, removalBlockers } from "../../worktree/remove";

/**
 * このCLIを実行しているタブが属するBoardを最後へ回す。そのBoardを閉じるとタブのPTYが落ち、
 * シェルごとCLI自身が巻き添えで殺されるため、先に閉じると残りのBoardが閉じられずに残る。
 * 呼び出し元タブが分からない場合（niwatermの外から実行した等）は順序をそのままにする
 */
async function selfBoardLast(
  endpoint: IpcEndpoint,
  boards: WorktreeBoard[],
): Promise<WorktreeBoard[]> {
  if (boards.length < 2) return boards;
  const resolved = await resolveTarget(endpoint, process.env["NIWATERM_TAB_ID"]);
  if (!resolved.ok) return boards;
  const self = resolved.target.boardId;
  return [
    ...boards.filter((board) => board.boardId !== self),
    ...boards.filter((board) => board.boardId === self),
  ];
}

/**
 * そのワークツリーで開いたBoardを閉じる。**ワークツリーを消し終えてから呼ぶこと**。
 * Boardを閉じるとその中のタブのPTYが落ち、そこからこのCLIを実行していた場合は
 * シェルごと巻き添えで殺される（先に閉じるとgitを起動する前に止まる）。
 * 閉じられないBoard（ワークスペースも1つだけの状態での最後の1つ等）があっても
 * 削除自体は済んでいるので警告に留める
 */
async function closeWorktreeBoards(path: string): Promise<void> {
  const endpoint = resolveIpcEndpoint();
  const found = await findWorktreeBoards(endpoint, toAppAccessiblePath(endpoint, path));
  if (!found.ok) {
    console.error(`warning: 対応するBoardを探せませんでした: ${found.error}`);
    return;
  }
  for (const board of await selfBoardLast(endpoint, found.boards)) {
    const closed = await closeBoard(endpoint, board.boardId);
    if (closed.ok) console.log(`board closed: ${board.boardId}`);
    else console.error(`warning: Board ${board.boardId} を閉じられませんでした: ${closed.error}`);
  }
}

/**
 * ブランチを消す。消せなかった場合の理由を返す（消し終えたワークツリーは戻せないので、
 * ここで止めずに呼び出し側でまとめて報告する）
 */
async function removeBranch(
  repoRoot: string,
  entry: WorktreeEntry,
  force: boolean,
): Promise<string | null> {
  if (entry.branch === null) {
    console.error("warning: detached HEADのワークツリーのため--delete-branchは使われません");
    return null;
  }
  const deleted = await deleteBranch({ repoRoot, branch: entry.branch, force });
  if (!deleted.ok) return deleted.error;
  console.log(`branch removed: ${entry.branch}`);
  return null;
}

export default define({
  name: "remove",
  description: "ワークツリーを削除し、対応するBoardを閉じる",
  args: {
    worktree: {
      type: "positional",
      required: true,
      description: "削除するワークツリー（ブランチ名・パス・ディレクトリ名のいずれか）",
    },
    force: {
      type: "boolean",
      short: "f",
      description:
        "未コミットの変更・未pushのコミット・ロックがあっても削除する（--delete-branchも未マージのブランチを消すようになる）",
    },
    "delete-branch": {
      type: "boolean",
      description:
        "ワークツリーを消した後、そのブランチも削除する（省略時は残す）。未マージのブランチは--forceも必要",
    },
    "keep-board": {
      type: "boolean",
      description:
        "そのワークツリーで開いたBoardを閉じずに残す（省略時は閉じる。cwdが消えたタブが残る）",
    },
    cwd: {
      type: "string",
      description:
        "対象リポジトリを探す起点ディレクトリ（省略時はこのコマンドを実行したディレクトリ）",
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const force = ctx.values.force === true;

    const list = await listWorktrees(cwd);
    if (!list.ok) failAndExit(`worktree removeに失敗しました: ${list.error}`);
    const main = mainWorktree(list.worktrees);
    if (!main) {
      failAndExit("worktree removeに失敗しました: メインワークツリーを特定できませんでした");
    }
    const repoRoot = main.path;

    const query = ctx.values.worktree;
    const found = findWorktreeByQuery(list.worktrees, query, cwd);
    if (found.kind === "not-found") {
      failAndExit(
        `worktree removeに失敗しました: ワークツリーが見つかりません: ${query}（niwaterm worktree listで一覧を確認できます）`,
      );
    }
    if (found.kind === "ambiguous") {
      const paths = found.candidates.map((entry) => entry.path).join("\n  ");
      failAndExit(
        `worktree removeに失敗しました: ${query}に一致するワークツリーが複数あります。パスで指定してください:\n  ${paths}`,
      );
    }
    const entry = found.worktree;
    if (entry.main) {
      failAndExit(
        `worktree removeに失敗しました: メインワークツリーは削除できません: ${entry.path}`,
      );
    }

    if (!force) {
      const blockers = removalBlockers(await inspectWorktree(repoRoot, entry));
      if (blockers.length > 0) {
        failAndExit(
          `worktree removeに失敗しました: ${entry.path} は削除しませんでした:\n` +
            blockers.map((blocker) => `  - ${blocker}`).join("\n") +
            "\n無視して削除するには--forceを付けてください",
        );
      }
    }

    // Windowsはカレントディレクトリにしているプロセスがあるとディレクトリを消せないため、
    // 自分のcwdだけでも先に外しておく（同じワークツリーで動いている他のシェルまでは面倒を見られない）
    if (isInsideWorktree(entry.path, process.cwd())) process.chdir(repoRoot);

    const removed = await removeWorktree({ repoRoot, path: entry.path, force });
    if (!removed.ok) failAndExit(`worktree removeに失敗しました: ${removed.error}`);
    console.log(`removed: ${entry.path}`);

    const branchError =
      ctx.values["delete-branch"] === true ? await removeBranch(repoRoot, entry, force) : null;

    if (ctx.values["keep-board"] !== true) await closeWorktreeBoards(entry.path);

    if (branchError !== null) {
      failAndExit(
        `worktree removeに失敗しました: ブランチ ${entry.branch} を削除できませんでした: ${branchError}\n` +
          `ワークツリー ${entry.path} は削除済みです` +
          (force ? "" : "\n未マージのブランチも削除するには--forceを付けてください"),
      );
    }
  },
});
