import { isAbsolute, resolve } from "node:path";
import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import {
  type IpcEndpoint,
  newBoard,
  renameBoard,
  resolveIpcEndpoint,
  sendKeys,
} from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";
import {
  isWorktreeOpenMode,
  resolveWorktreePlan,
  WORKTREE_OPEN_MODES,
  type WorktreeHook,
  type WorktreeHookContext,
  type WorktreeOpenMode,
} from "../../worktree/config";
import { ensureProjectTrust } from "../../worktree/trust";
import {
  addWorktree,
  branchExists,
  findWorktreeByBranch,
  listWorktrees,
  mainWorktree,
} from "../../worktree/git";

/**
 * `cd`へ渡すパスを引用する。POSIXシェルもPowerShellもシングルクォート文字列を解釈するため`'`で包む。
 * 内部の`'`の閉じ直し方はPOSIX式（`'\''`）で、`'`を含むパスをPowerShellのタブへ送ると崩れるが、
 * 引用せずに空白入りパスを送るほうが壊れる範囲が広いのでこちらを採る
 */
function shellQuotePath(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

/**
 * 作成後フックを順に実行する。Boardを開く前に終わらせるので、タブが立ち上がる時点で
 * セットアップ（bun install等）が済んでいる。
 * 失敗したらワークツリーは残したまま終了コード1で止める。準備できていないワークツリーを
 * 開いて作業を始めてしまうより、直して開き直せるほうがよいため
 */
async function runCreateHooks(hooks: WorktreeHook[], ctx: WorktreeHookContext): Promise<void> {
  if (hooks.length === 0) return;
  console.log(`running worktree hook (${hooks.length})...`);
  for (const hook of hooks) {
    try {
      await hook(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failAndExit(
        `worktree newに失敗しました: 作成後フックが失敗しました: ${message}\n` +
          `ワークツリーは ${ctx.worktreePath} に残っています`,
      );
    }
  }
}

/** 作成したワークツリーをniwatermで開く。開き方はモードごとに完結させる */
async function openWorktree(
  endpoint: IpcEndpoint,
  mode: WorktreeOpenMode,
  path: string,
  branch: string,
  workspaceId: string | undefined,
): Promise<void> {
  if (mode === "none") return;

  if (mode === "current-tab") {
    const target = createTargetResolver(endpoint, "worktree new", {});
    // シェルは実行中のこのCLIが終わるまで入力を読まないため、キーはtty側で待たされてから流れる
    const result = await sendKeys(endpoint, await target.tabId(), [
      `cd ${shellQuotePath(path)}`,
      "Enter",
    ]);
    if (!result.ok) failAndExit(`worktree newに失敗しました: ${result.error}`);
    return;
  }

  const created = await newBoard(endpoint, workspaceId, path, mode === "board-switch");
  if (!created.ok) failAndExit(`worktree newに失敗しました: ${created.error}`);
  // 遷移しないモードではサイドバーの見分けが唯一の手がかりになるため、必ずブランチ名を付ける
  const renamed = await renameBoard(endpoint, created.boardId, branch);
  if (!renamed.ok) console.error(`warning: Board名を設定できませんでした: ${renamed.error}`);
  console.log(`board: ${created.boardId}`);
}

export default define({
  name: "new",
  description: "ワークツリーを作成し、niwatermで開く",
  args: {
    branch: {
      type: "positional",
      required: true,
      description: "ワークツリーで使うブランチ名（未作成なら新規ブランチとして作る）",
    },
    from: {
      type: "string",
      description: "新規ブランチの分岐元（省略時はHEAD）。既存ブランチを指定した場合は使えない",
    },
    path: {
      type: "string",
      description:
        "作成先のパス（省略時は設定の置き場所テンプレートで決まる。相対パスは実行したディレクトリ基準）",
    },
    open: {
      type: "string",
      description: `作成後の開き方（${WORKTREE_OPEN_MODES.join(" | ")}）。省略時は設定のworktree.open（既定はboard）`,
    },
    workspace: {
      type: "string",
      short: "w",
      description: "Boardの作成先workspaceId（省略時は現在アクティブなワークスペース）",
    },
    trust: {
      type: "boolean",
      description:
        "プロジェクトローカル設定（<repoRoot>/.niwaterm/config.ts）の確認を省いて信頼する",
    },
    cwd: {
      type: "string",
      description:
        "対象リポジトリを探す起点ディレクトリ（省略時はこのコマンドを実行したディレクトリ）",
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const branch = ctx.values.branch;

    const list = await listWorktrees(cwd);
    if (!list.ok) failAndExit(`worktree newに失敗しました: ${list.error}`);
    const main = mainWorktree(list.worktrees);
    if (!main) failAndExit("worktree newに失敗しました: メインワークツリーを特定できませんでした");
    const repoRoot = main.path;

    // プロジェクトローカル設定はimportした時点でコードが走るため、読む前に承認を取る
    const trust = await ensureProjectTrust(repoRoot, { assumeTrusted: ctx.values.trust === true });
    const plan = await resolveWorktreePlan(
      { repoRoot, branch },
      { includeProject: trust === "trusted" },
    );
    const openMode = ctx.values.open ?? plan.open.value;
    if (!isWorktreeOpenMode(openMode)) {
      failAndExit(
        `worktree newに失敗しました: --openの値が不正です: ${openMode}（${WORKTREE_OPEN_MODES.join(" | ")}）`,
      );
    }

    const existing = findWorktreeByBranch(list.worktrees, branch);
    let path: string;
    if (existing) {
      // 作成済みでもエラーにせず、そのワークツリーを開く操作として続ける。
      // ただし作成時にしか効かないオプションは黙って捨てず、効いていないことを伝える
      path = existing.path;
      const ignored = [
        ...(ctx.values.from !== undefined ? ["--from"] : []),
        ...(ctx.values.path !== undefined ? ["--path"] : []),
      ];
      if (ignored.length > 0) {
        console.error(`warning: 作成済みのワークツリーのため${ignored.join("・")}は使われません`);
      }
      console.log(`exists: ${path}`);
    } else {
      if (ctx.values.from !== undefined && (await branchExists(branch, repoRoot))) {
        failAndExit(
          `worktree newに失敗しました: ブランチ ${branch} は既にあるため--fromは指定できません`,
        );
      }
      const explicit = ctx.values.path;
      path =
        explicit === undefined
          ? plan.path
          : isAbsolute(explicit)
            ? explicit
            : resolve(cwd, explicit);
      const added = await addWorktree({
        repoRoot,
        path,
        branch,
        ...(ctx.values.from !== undefined ? { from: ctx.values.from } : {}),
      });
      if (!added.ok) failAndExit(`worktree newに失敗しました: ${added.error}`);
      console.log(`created: ${path}`);
    }

    // 既存のワークツリーを開き直しただけのときはフックを走らせない（bun install等の再実行を避ける）
    if (!existing) await runCreateHooks(plan.onCreate, { repoRoot, worktreePath: path, branch });

    await openWorktree(resolveIpcEndpoint(), openMode, path, branch, ctx.values.workspace);
  },
});
