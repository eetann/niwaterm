/**
 * カレントディレクトリをワークツリーへ移してからフックを実行し、終わったら元へ戻す。
 * `Bun.$`・`Bun.spawn`の既定のcwdが移るので、フック側で`.cwd(ctx.worktreePath)`を書かずに済む。
 * cwdはプロセス全体で共有されるが、フックは1つずつawaitするので他の処理と取り合わない
 */
export async function runInWorktree<T>(worktreePath: string, fn: () => T | Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(worktreePath);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}
