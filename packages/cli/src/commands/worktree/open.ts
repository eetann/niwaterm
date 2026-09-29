import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint } from "../../ipc-client";
import {
  isWorktreeOpenMode,
  resolveWorktreeSettings,
  WORKTREE_OPEN_MODES,
  type WorktreeOpenMode,
  worktreeDirSourcesFor,
} from "../../worktree/config";
import { findWorktreeByQuery, listWorktrees, mainWorktree } from "../../worktree/git";
import { openWorktree, resolveWorktreeLayout } from "../../worktree/open";
import { ensureProjectTrust } from "../../worktree/trust";

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
    layout: {
      type: "string",
      description:
        "Boardへ適用するレイアウトプリセット名（省略時は設定のworktree.layout）。Boardを新規に作ったときだけ適用され、そのBoardの起動時レイアウトとしても紐づく",
    },
    workspace: {
      type: "string",
      short: "w",
      description: "Boardの作成先workspaceId（省略時は現在アクティブなワークスペース）",
    },
    name: {
      type: "string",
      short: "n",
      description: "Boardに付ける名前（省略時はブランチ名。既に開いているBoardにも反映される）",
    },
    trust: {
      type: "boolean",
      description:
        "プロジェクトローカル設定（<repoRoot>/.niwaterm/config.ts）の確認を省いて信頼する（レイアウトを適用する場合のみ必要）",
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
    const main = mainWorktree(list.worktrees);
    if (!main) failAndExit("worktree openに失敗しました: メインワークツリーを特定できませんでした");
    const repoRoot = main.path;

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
      repoRoot,
      path: found.worktree.path,
      branch: found.worktree.branch,
      created: false,
      ...(ctx.values.workspace !== undefined ? { workspaceId: ctx.values.workspace } : {}),
      ...(ctx.values.name !== undefined ? { name: ctx.values.name } : {}),
      boardSetup: {
        ...(ctx.values.layout !== undefined ? { explicitLayout: ctx.values.layout } : {}),
        // Boardを新規に作るときだけ呼ばれる。ワークツリーへ移るだけの用途で
        // プロジェクトローカル設定の確認が出ないよう、設定の読み取りはここまで遅らせる
        resolve: async () => {
          const trust = await ensureProjectTrust(repoRoot, {
            assumeTrusted: ctx.values.trust === true,
          });
          const settings = await resolveWorktreeSettings(worktreeDirSourcesFor(repoRoot), {
            includeProject: trust === "trusted",
          });
          const preset = resolveWorktreeLayout({
            commandName: "worktree open",
            explicit: ctx.values.layout,
            configured: settings.layout.value,
            trust,
          });
          return {
            ...(preset !== undefined ? { preset } : {}),
            // --trustはプロジェクトローカル設定を持たないリポジトリでも承認の意思表示として効かせる。
            // プリセットの解決元がリポジトリの外にある場合、ensureProjectTrustは"absent"を返すため
            trusted: trust === "trusted" || ctx.values.trust === true,
            onOpen: settings.onOpen,
          };
        },
      },
    });
  },
});
