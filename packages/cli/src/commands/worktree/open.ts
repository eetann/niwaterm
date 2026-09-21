import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint } from "../../ipc-client";
import {
  isWorktreeOpenMode,
  WORKTREE_OPEN_MODES,
  type WorktreeOpenMode,
} from "../../worktree/config";
import { findWorktreeByQuery, listWorktrees } from "../../worktree/git";
import { openWorktree } from "../../worktree/open";

/**
 * 設定のworktree.openは「作成後の開き方」の既定値なのでここには効かせない。
 * openと打った時点でそこへ移りたいはずなので、遷移するモードを既定にする
 */
const DEFAULT_OPEN_MODE: WorktreeOpenMode = "board-switch";

export default define({
  name: "open",
  description: "既存のワークツリーをniwatermで開く",
  args: {
    worktree: {
      type: "positional",
      required: true,
      description: "開くワークツリー（ブランチ名・パス・ディレクトリ名のいずれか）",
    },
    open: {
      type: "string",
      description: `開き方（${WORKTREE_OPEN_MODES.join(" | ")}）。省略時は${DEFAULT_OPEN_MODE}`,
    },
    workspace: {
      type: "string",
      short: "w",
      description: "Boardの作成先workspaceId（省略時は現在アクティブなワークスペース）",
    },
    cwd: {
      type: "string",
      description:
        "対象リポジトリを探す起点ディレクトリ（省略時はこのコマンドを実行したディレクトリ）",
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const mode = ctx.values.open ?? DEFAULT_OPEN_MODE;
    if (!isWorktreeOpenMode(mode)) {
      failAndExit(
        `worktree openに失敗しました: --openの値が不正です: ${mode}（${WORKTREE_OPEN_MODES.join(" | ")}）`,
      );
    }

    const list = await listWorktrees(cwd);
    if (!list.ok) failAndExit(`worktree openに失敗しました: ${list.error}`);

    const query = ctx.values.worktree;
    const found = findWorktreeByQuery(list.worktrees, query, cwd);
    if (found.kind === "not-found") {
      failAndExit(
        `worktree openに失敗しました: ワークツリーが見つかりません: ${query}（niwaterm worktree listで一覧を確認できます）`,
      );
    }
    if (found.kind === "ambiguous") {
      const paths = found.candidates.map((entry) => entry.path).join("\n  ");
      failAndExit(
        `worktree openに失敗しました: ${query}に一致するワークツリーが複数あります。パスで指定してください:\n  ${paths}`,
      );
    }

    console.log(`worktree: ${found.worktree.path}`);
    await openWorktree({
      endpoint: resolveIpcEndpoint(),
      commandName: "worktree open",
      mode,
      path: found.worktree.path,
      branch: found.worktree.branch,
      ...(ctx.values.workspace !== undefined ? { workspaceId: ctx.values.workspace } : {}),
    });
  },
});
