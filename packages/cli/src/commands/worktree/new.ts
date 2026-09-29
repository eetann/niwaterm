import { isAbsolute, resolve } from "node:path";
import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint } from "../../ipc-client";
import {
  isWorktreeOpenMode,
  resolveWorktreePlan,
  WORKTREE_OPEN_MODES,
  type WorktreeHook,
  type WorktreeHookContext,
} from "../../worktree/config";
import { openWorktree, resolveWorktreeLayout } from "../../worktree/open";
import { ensureProjectTrust } from "../../worktree/trust";
import {
  addWorktree,
  branchExists,
  fetchRemote,
  findWorktreeByBranch,
  listRemotes,
  listWorktrees,
  mainWorktree,
} from "../../worktree/git";
import {
  isWorktreeTrackMode,
  pickDefaultRemote,
  resolveWorktreeSource,
  splitRemoteRef,
  WORKTREE_TRACK_MODES,
  type WorktreeTrackMode,
} from "../../worktree/track";

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

interface TrackInput {
  /** コマンドラインで受け取ったままのブランチ指定。リモート名が付いていることがある */
  branch: string;
  track?: string;
  remote?: string;
  from?: string;
}

interface TrackRequest {
  mode: WorktreeTrackMode;
  /** trackに使うリモート。リモートが無い・既定を決められない場合はnull */
  remote: string | null;
  /** リモート名を除いたローカルブランチ名。ワークツリーの置き場所もBoard名もこちらで決まる */
  branch: string;
}

/**
 * `--track`・`--remote`・ブランチ名に付いたリモート名から、ブランチの用意の仕方を決める。
 * `origin/feat/x`のようにリモート名を付けた指定は`--track remote`の明示として扱い、
 * `--from`（分岐元）は新規ブランチにしかならないので`--track new`として扱う
 */
function resolveTrackRequest(input: TrackInput, remotes: string[]): TrackRequest {
  let explicitMode: WorktreeTrackMode | undefined;
  if (input.track !== undefined) {
    if (!isWorktreeTrackMode(input.track)) {
      failAndExit(
        `worktree newに失敗しました: --trackの値が不正です: ${input.track}（${WORKTREE_TRACK_MODES.join(" | ")}）`,
      );
    }
    explicitMode = input.track;
  }

  const prefixed = splitRemoteRef(input.branch, remotes);
  const branch = prefixed.branch;

  if (prefixed.remote !== null && input.remote !== undefined && prefixed.remote !== input.remote) {
    failAndExit(
      `worktree newに失敗しました: ブランチ名のリモート（${prefixed.remote}）と--remote（${input.remote}）が食い違っています`,
    );
  }
  if (input.from !== undefined && explicitMode !== undefined && explicitMode !== "new") {
    failAndExit("worktree newに失敗しました: --fromは--track newでのみ使えます");
  }
  if (input.from !== undefined && prefixed.remote !== null) {
    failAndExit(
      `worktree newに失敗しました: --fromはリモート名付きのブランチ指定（${input.branch}）とは一緒に使えません`,
    );
  }
  if (input.remote !== undefined && !remotes.includes(input.remote)) {
    const known =
      remotes.length > 0 ? `設定済み: ${remotes.join(", ")}` : "リモートが設定されていません";
    failAndExit(`worktree newに失敗しました: リモート ${input.remote} がありません（${known}）`);
  }

  const mode: WorktreeTrackMode =
    explicitMode ??
    (prefixed.remote !== null ? "remote" : input.from !== undefined ? "new" : "auto");

  const explicitRemote = prefixed.remote ?? input.remote;
  if (explicitRemote !== undefined) return { mode, remote: explicitRemote, branch };
  // 手元のブランチしか見ないモードでは、リモートが決まらなくても困らない
  if (mode === "local" || mode === "new") return { mode, remote: null, branch };

  const fallback = pickDefaultRemote(remotes);
  if (fallback.ok) return { mode, remote: fallback.remote, branch };
  // autoはリモートを選べなくてもローカル・新規で解決できるので、ここでは止めない
  if (mode === "auto") return { mode, remote: null, branch };
  failAndExit(`worktree newに失敗しました: ${fallback.error}`);
}

interface FetchBeforeCreateOptions {
  repoRoot: string;
  remote: string | null;
  mode: WorktreeTrackMode;
  enabled: boolean;
}

/**
 * ワークツリーを作る前にリモートを更新する。失敗しても止めないのは、オフラインでも
 * ローカルブランチのワークツリーは作れるべきだから
 */
async function fetchBeforeCreate(opts: FetchBeforeCreateOptions): Promise<void> {
  // localは手元のブランチしか見ないので、ネットワークに出る意味が無い
  if (!opts.enabled || opts.remote === null || opts.mode === "local") return;
  console.log(`fetching ${opts.remote}...`);
  const result = await fetchRemote(opts.remote, opts.repoRoot);
  if (!result.ok) {
    console.error(`warning: git fetch ${opts.remote}に失敗しました: ${result.error}`);
  }
}

export default define({
  name: "new",
  description: "ワークツリーを作成し、niwatermで開く",
  args: {
    branch: {
      type: "positional",
      required: true,
      description:
        "ワークツリーで使うブランチ名（origin/feat/xのようにリモート名を付けてもよい。どこにも無ければ新規ブランチとして作る）",
    },
    from: {
      type: "string",
      description: "新規ブランチの分岐元（省略時はHEAD）。既存ブランチを指定した場合は使えない",
    },
    track: {
      type: "string",
      description: `ブランチの用意の仕方（${WORKTREE_TRACK_MODES.join(" | ")}）。省略時はauto（ローカル→リモート→新規の順に探す）`,
    },
    remote: {
      type: "string",
      description: "trackするリモート名（省略時はリモートが1つならそれ、複数ならorigin）",
    },
    fetch: {
      type: "boolean",
      negatable: true,
      description:
        "ワークツリーを作る前にリモートをfetchする（--no-fetchで抑止。省略時は設定のworktree.fetch、既定はfetchする）",
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
      description: "Boardに付ける名前（省略時はブランチ名）",
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

    const list = await listWorktrees(cwd);
    if (!list.ok) failAndExit(`worktree newに失敗しました: ${list.error}`);
    const main = mainWorktree(list.worktrees);
    if (!main) failAndExit("worktree newに失敗しました: メインワークツリーを特定できませんでした");
    const repoRoot = main.path;

    // リモート名を剥がしてからでないと、ワークツリーの置き場所もBoard名も
    // origin付きの文字列で決まってしまう
    const track = resolveTrackRequest(
      {
        branch: ctx.values.branch,
        ...(ctx.values.track !== undefined ? { track: ctx.values.track } : {}),
        ...(ctx.values.remote !== undefined ? { remote: ctx.values.remote } : {}),
        ...(ctx.values.from !== undefined ? { from: ctx.values.from } : {}),
      },
      await listRemotes(repoRoot),
    );
    const branch = track.branch;

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

    // ワークツリーを作る前に確かめる。未承認でレイアウトが使えないなら、
    // 中途半端にワークツリーだけ増やさず手前で止める
    const layoutPreset = resolveWorktreeLayout({
      commandName: "worktree new",
      explicit: ctx.values.layout,
      configured: plan.layout.value,
      trust,
    });

    const existing = findWorktreeByBranch(list.worktrees, branch);
    let path: string;
    if (existing) {
      // 作成済みでもエラーにせず、そのワークツリーを開く操作として続ける。
      // ただし作成時にしか効かないオプションは黙って捨てず、効いていないことを伝える
      path = existing.path;
      const ignored = [
        ...(ctx.values.from !== undefined ? ["--from"] : []),
        ...(ctx.values.path !== undefined ? ["--path"] : []),
        ...(ctx.values.track !== undefined ? ["--track"] : []),
        ...(ctx.values.remote !== undefined ? ["--remote"] : []),
        ...(ctx.values.fetch !== undefined ? [ctx.values.fetch ? "--fetch" : "--no-fetch"] : []),
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
      await fetchBeforeCreate({
        repoRoot,
        remote: track.remote,
        mode: track.mode,
        enabled: ctx.values.fetch ?? plan.fetch.value,
      });
      const source = await resolveWorktreeSource({
        repoRoot,
        branch,
        mode: track.mode,
        remote: track.remote,
        ...(ctx.values.from !== undefined ? { from: ctx.values.from } : {}),
      });
      if (!source.ok) failAndExit(`worktree newに失敗しました: ${source.error}`);
      const explicit = ctx.values.path;
      path =
        explicit === undefined
          ? plan.path
          : isAbsolute(explicit)
            ? explicit
            : resolve(cwd, explicit);
      const added = await addWorktree({ repoRoot, path, branch, source: source.source });
      if (!added.ok) failAndExit(`worktree newに失敗しました: ${added.error}`);
      console.log(`created: ${path}`);
    }

    // 既存のワークツリーを開き直しただけのときはフックを走らせない（bun install等の再実行を避ける）
    if (!existing) await runCreateHooks(plan.onCreate, { repoRoot, worktreePath: path, branch });

    await openWorktree({
      endpoint: resolveIpcEndpoint(),
      commandName: "worktree new",
      mode: openMode,
      repoRoot,
      path,
      branch,
      created: !existing,
      ...(ctx.values.workspace !== undefined ? { workspaceId: ctx.values.workspace } : {}),
      ...(ctx.values.name !== undefined ? { name: ctx.values.name } : {}),
      boardSetup: {
        ...(ctx.values.layout !== undefined ? { explicitLayout: ctx.values.layout } : {}),
        resolve: async () => ({
          ...(layoutPreset !== undefined ? { preset: layoutPreset } : {}),
          // --trustはプロジェクトローカル設定を持たないリポジトリでも承認の意思表示として効かせる。
          // プリセットの解決元がリポジトリの外にある場合、ensureProjectTrustは"absent"を返すため
          trusted: trust === "trusted" || ctx.values.trust === true,
          onOpen: plan.onOpen,
        }),
      },
    });
  },
});
