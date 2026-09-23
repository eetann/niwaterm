import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import {
  closeBoard,
  type IpcEndpoint,
  resolveIpcEndpoint,
  resolveTarget,
  toAppAccessiblePath,
} from "../../ipc-client";
import { findWorktreeBoards } from "../../worktree/board";
import {
  deleteBranch,
  listWorktrees,
  mainWorktree,
  removeWorktree,
  type WorktreeEntry,
} from "../../worktree/git";
import {
  inspectWorktree,
  isInsideWorktree,
  removalBlockers,
  resolveRemovalTargets,
} from "../../worktree/remove";

/** 複数行の理由を箇条書きの1項目へ畳む。2行目以降は先頭のマーカー分だけ下げる */
function bullet(reason: string): string {
  const [head, ...rest] = reason.split("\n");
  return [`  - ${head}`, ...rest.map((line) => `    ${line}`)].join("\n");
}

/** 失敗理由をまとめて報告して終了する。1件だけならそのまま続け、複数なら箇条書きにする */
function failWithReasons(reasons: string[], hint: string): never {
  const only = reasons.length === 1 ? reasons[0] : undefined;
  const body = only === undefined ? `\n${reasons.map(bullet).join("\n")}` : ` ${only}`;
  failAndExit(`worktree removeに失敗しました:${body}${hint}`);
}

/** `--force`無しでは消せない対象を、理由付きで並べる。空配列なら全部消してよい */
async function blockedReasons(repoRoot: string, targets: WorktreeEntry[]): Promise<string[]> {
  const reasons: string[] = [];
  for (const entry of targets) {
    const blockers = removalBlockers(await inspectWorktree(repoRoot, entry));
    if (blockers.length === 0) continue;
    reasons.push(
      `${entry.path} は削除しませんでした:\n${blockers.map((blocker) => `  - ${blocker}`).join("\n")}`,
    );
  }
  return reasons;
}

/**
 * このCLIを実行しているタブが属するBoard。分からなければnull。
 * `NIWATERM_TAB_ID`が無いまま解決させるとアクティブなBoardが返るため、環境変数がある場合だけ問う
 * （niwatermの外から実行した場合は閉じてもCLIが死なないので、除外してはいけない）
 */
async function selfBoardId(endpoint: IpcEndpoint): Promise<string | null> {
  const tabId = process.env["NIWATERM_TAB_ID"];
  if (tabId === undefined) return null;
  const resolved = await resolveTarget(endpoint, tabId);
  return resolved.ok ? resolved.target.boardId : null;
}

/**
 * それらのワークツリーで開いたBoardを閉じる。**このCLIを実行しているタブが属するBoardは閉じない**。
 * 閉じるとそのタブのPTYが落ち、シェルごとCLI自身が巻き添えで殺されるため、残りのBoardも
 * 閉じられず出力と終了コードも受け取れなくなる。閉じられないBoard（ワークスペースも1つだけの
 * 状態での最後の1つ等）があっても削除自体は済んでいるので警告に留める
 */
async function closeWorktreeBoards(paths: string[]): Promise<void> {
  const endpoint = resolveIpcEndpoint();
  const self = await selfBoardId(endpoint);
  const seen = new Set<string>();
  for (const path of paths) {
    const found = await findWorktreeBoards(endpoint, toAppAccessiblePath(endpoint, path));
    if (!found.ok) {
      console.error(`warning: ${path} に対応するBoardを探せませんでした: ${found.error}`);
      continue;
    }
    for (const board of found.boards) {
      if (seen.has(board.boardId)) continue;
      seen.add(board.boardId);
      if (board.boardId === self) {
        console.error(
          `warning: Board ${board.boardId} はこのコマンドを実行しているBoardのため閉じません（cwdが消えたタブが残ります）`,
        );
        continue;
      }
      const closed = await closeBoard(endpoint, board.boardId);
      if (closed.ok) console.log(`board closed: ${board.boardId}`);
      else console.error(`warning: Board ${board.boardId} を閉じられませんでした: ${closed.error}`);
    }
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
    console.error(
      `warning: ${entry.path} はdetached HEADのワークツリーのため--delete-branchは使われません`,
    );
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
      multiple: true,
      description:
        "削除するワークツリー（ブランチ名・パス・ディレクトリ名のいずれか）。スペース区切りで複数指定できる",
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

    const found = resolveRemovalTargets(list.worktrees, ctx.values.worktree, cwd);
    if (!found.ok) failWithReasons(found.errors, "");
    const targets = found.targets;

    if (!force) {
      const blocked = await blockedReasons(repoRoot, targets);
      if (blocked.length > 0) {
        failWithReasons(blocked, "\n無視して削除するには--forceを付けてください");
      }
    }

    // Windowsはカレントディレクトリにしているプロセスがあるとディレクトリを消せないため、
    // 自分のcwdだけでも先に外しておく（同じワークツリーで動いている他のシェルまでは面倒を見られない）
    if (targets.some((entry) => isInsideWorktree(entry.path, process.cwd()))) {
      process.chdir(repoRoot);
    }

    const removedPaths: string[] = [];
    const failures: string[] = [];
    let branchFailed = false;
    for (const entry of targets) {
      const removed = await removeWorktree({ repoRoot, path: entry.path, force });
      if (!removed.ok) {
        failures.push(`${entry.path} を削除できませんでした: ${removed.error}`);
        continue;
      }
      console.log(`removed: ${entry.path}`);
      removedPaths.push(entry.path);
      if (ctx.values["delete-branch"] !== true) continue;
      const branchError = await removeBranch(repoRoot, entry, force);
      if (branchError === null) continue;
      branchFailed = true;
      failures.push(
        `ブランチ ${entry.branch} を削除できませんでした（ワークツリー ${entry.path} は削除済みです）: ${branchError}`,
      );
    }

    if (ctx.values["keep-board"] !== true && removedPaths.length > 0) {
      await closeWorktreeBoards(removedPaths);
    }

    if (failures.length > 0) {
      failWithReasons(
        failures,
        branchFailed && !force ? "\n未マージのブランチも削除するには--forceを付けてください" : "",
      );
    }
  },
});
