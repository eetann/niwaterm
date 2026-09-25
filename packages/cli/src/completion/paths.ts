import { type Dirent, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CompletionItem } from "./sources";

/**
 * `~`始まりを展開する。シェルは補完中の語をクォートしたまま渡してくるため、
 * ここへ来る時点では`~`が展開されていない
 */
function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 入力中のパスから、その1階層分の候補を作る。
 *
 * 補完候補はシェルがそのまま挿入するので、入力済みの部分（`~/src/`）を頭に付けたまま返す。
 * 区切りは`/`だけを見る: Windowsでもパス解決は`/`で通り、`\`はシェル側のエスケープと
 * 紛れるため
 */
export function pathCompletions(current: string, directoriesOnly: boolean): CompletionItem[] {
  const separator = current.lastIndexOf("/");
  const prefix = separator === -1 ? current : current.slice(separator + 1);
  const typedDirectory = separator === -1 ? "" : current.slice(0, separator + 1);
  let entries: Dirent[];
  try {
    entries = readdirSync(expandTilde(typedDirectory === "" ? "." : typedDirectory), {
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  const items: CompletionItem[] = [];
  for (const entry of entries) {
    // 隠しファイルは数が多いうえ普段は選ばないので、`.`まで打ったときだけ候補にする
    if (entry.name.startsWith(".") && !prefix.startsWith(".")) continue;
    const directory =
      entry.isDirectory() ||
      (entry.isSymbolicLink() && isDirectory(join(entry.parentPath, entry.name)));
    if (directoriesOnly && !directory) continue;
    items.push({ value: `${typedDirectory}${entry.name}${directory ? "/" : ""}` });
  }
  return items;
}
