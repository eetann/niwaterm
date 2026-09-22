// customViewのHTML（worktrees.html）から niwaterm.call で呼ばれるハンドラ。
// gitとniwatermの操作はniwaterm CLIへ委ね、ここではHTMLが扱いやすい形へ整えるだけにする
// （CLI側にワークツリーの探索・作成・Boardの割り当てが揃っているため、同じ処理を書き直さない）。

import type { CustomViewHandlers, Niwa } from "@niwaterm/config";

/** PATHにあるniwaterm CLIのコマンド名。devビルドで試すなら"niwaterm-dev"に変える */
const CLI = "niwaterm";

export interface WorktreeItem {
  path: string;
  /** detached HEAD・bareのワークツリーは空文字列 */
  branch: string;
  head: string;
  /** main / bare / detached / locked / prunable */
  flags: string[];
}

/**
 * 操作の起点にするディレクトリ。フォーカス中タイルのアクティブタブが今いる場所を使う
 * （サイドバーから呼ぶため、直前に触っていたタブのリポジトリが対象になる）。
 * cwdの報告にはシェル統合（contrib/shell-integration）が必要
 */
function currentCwd(niwa: Niwa): string | undefined {
  return niwa.tile.current()?.cwd;
}

/** 空白を含むパス・ブランチ名をシェルへ渡すためのクォート */
function quote(value: string): string {
  if (value.includes('"')) throw new Error(`" を含む値は扱えません: ${value}`);
  return `"${value}"`;
}

async function runCli(niwa: Niwa, args: string): Promise<string> {
  const cwd = currentCwd(niwa);
  const result = await niwa.shell.run(`${CLI} ${args}`, cwd ? { cwd } : {});
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${args} に失敗しました`);
  }
  return result.stdout;
}

/** `niwaterm worktree list`のTSV（path/branch/HEAD/フラグ、値の無い列は"-"） */
function parseWorktreeList(stdout: string): WorktreeItem[] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [path = "", branch = "-", head = "-", flags = "-"] = line.split("\t");
      return {
        path,
        branch: branch === "-" ? "" : branch,
        head: head === "-" ? "" : head,
        flags: flags === "-" ? [] : flags.split(","),
      };
    });
}

export const worktreeHandlers: CustomViewHandlers = {
  /** ワークツリー一覧。cwdも返してHTML側に「どのリポジトリを見ているか」を出せるようにする */
  list: async (_payload: null, niwa) => {
    const cwd = currentCwd(niwa);
    if (!cwd) {
      throw new Error(
        "対象のディレクトリが分かりません（シェル統合を入れるとタブのcwdが取れます）",
      );
    }
    return { cwd, items: parseWorktreeList(await runCli(niwa, "worktree list")) };
  },

  /** 既存のワークツリーを開く。`worktree open`の既定どおり、開いたBoardへ遷移する */
  open: async (payload: { path: string }, niwa) => {
    await runCli(niwa, `worktree open ${quote(payload.path)}`);
    return null;
  },

  /**
   * ブランチのワークツリーを作る（既にあれば作成を飛ばしてそれを開く）。
   * `--open board`は「新しいBoardで開くが、遷移はしない」で、作業中のBoardを奪わないための既定。
   * 作ってすぐそこへ移りたい場合は`board-switch`に変える
   */
  create: async (payload: { branch: string }, niwa) => {
    await runCli(niwa, `worktree new ${quote(payload.branch)} --open board`);
    return null;
  },
};
