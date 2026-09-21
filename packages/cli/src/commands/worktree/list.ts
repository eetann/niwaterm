import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { listWorktrees, type WorktreeEntry, worktreeFlags } from "../../worktree/git";

/**
 * TSV1行分。値が無い箇所は"-"で埋め、列位置がずれないようにする
 * （`cut -f2`のようなスクリプトからの読み取りを崩さないため）
 */
function formatEntry(entry: WorktreeEntry): string {
  const flags = worktreeFlags(entry);
  return [
    entry.path,
    entry.branch ?? "-",
    entry.head ?? "-",
    flags.length > 0 ? flags.join(",") : "-",
  ].join("\t");
}

export default define({
  name: "list",
  description:
    "gitのワークツリー一覧を表示（path/branch/HEAD/フラグのTSV。niwatermアプリが起動していなくても動く）",
  args: {
    cwd: {
      type: "string",
      description:
        "対象リポジトリを探す起点ディレクトリ（省略時はこのコマンドを実行したディレクトリ）",
    },
  },
  run: async (ctx) => {
    const result = await listWorktrees(ctx.values.cwd ?? process.cwd());
    if (!result.ok) {
      failAndExit(`worktree listに失敗しました: ${result.error}`);
    }
    for (const entry of result.worktrees) {
      console.log(formatEntry(entry));
    }
  },
});
