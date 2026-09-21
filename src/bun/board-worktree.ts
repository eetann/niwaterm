// Boardに紐づくワークツリー（PersistedBoard.worktreePath）まわりの純関数。
// 紐づけ自体の保持はworkspace.ts、存在チェックはdir-existence.tsが持つ。
import { isAbsolute, resolve } from "node:path";
import type { NewTabCwdMode } from "@niwaterm/config";
import { resolveActualCwd } from "./wsl-cwd";

/**
 * 新しいタブ（タブ追加・タイル分割・ポップアップ）のcwdを、Boardに紐づくワークツリーにするか決める。
 * 呼び出し側の既定（今のタブのcwdを引き継ぐ）に任せる場合はundefinedを返す。
 *
 * 存在しないディレクトリを返さないのは、PTYの起動自体が失敗してタブが使えなくなるため。
 * 消えた紐づけはサイドバーの警告アイコンで気づける想定で、ここでは黙って引き継ぎへ倒す
 */
export function resolveBoardNewTabCwd(
  mode: NewTabCwdMode,
  worktreePath: string | undefined,
  dirExists: (path: string) => boolean,
): string | undefined {
  if (mode !== "worktree") return undefined;
  if (worktreePath === undefined) return undefined;
  return dirExists(worktreePath) ? worktreePath : undefined;
}

/**
 * 入力ダイアログへ打たれたパスを、fs・Bun.spawnが解釈できる絶対パスへ直す。
 * 空文字列（trim後）は紐づけ解除の意味でnullを返す。
 *
 * baseCwd・shellCommandは入力欄の初期値になったタブのもの。相対パスをそのタブのcwd起点で
 * 解決したうえで、WSLタブでLinuxの絶対パスを打たれた場合はタブのcwdと同じUNC形式へ直す
 * （変換しないとWindows側から見て存在しないパスになり、紐づけた直後に警告アイコンが出る）
 */
export function resolveWorktreeInputPath(
  input: string,
  baseCwd: string | undefined,
  shellCommand: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (isAbsolute(trimmed)) return resolveActualCwd(trimmed, shellCommand, platform);
  if (baseCwd === undefined) return null;
  return resolve(baseCwd, trimmed);
}
