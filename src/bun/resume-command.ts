// アプリ終了時に実行中だったコマンドを、次回起動時に打ち直してよいかの判定。
// 判定は上から順に (1) 複合コマンドを丸ごと除外 (2) 内部のdenyリスト (3) ユーザー設定の許可リスト。
// denyリストは許可リストの書き間違い（"git"を許可してgit pushまで通る等）に対する安全網で、
// 設定から外す手段は用意しない。

/**
 * 含んでいたら打ち直さない文字列。複合コマンド（`;` `&&` `||` `|`）・コマンド置換・リダイレクト・
 * バックグラウンド実行・複数行はどれも、先頭の単語だけでは何が走るか決まらない。
 * 各区切りへdenyリストを当てる方式は抜け道を塞ぎ切れないため、含んだ時点で対象外にする
 */
const COMPOUND_MARKERS = [";", "&", "|", "`", "$(", "<", ">", "\n", "\r"];

/**
 * 打ち直さないコマンド。単語単位の前方一致で判定し、コマンド行のどの位置に現れても当たる
 * （`watch rm -rf x`・`docker rm x`のように別のコマンド経由で渡されるものも弾くため）。
 * パス付き（`/bin/rm`）は末尾の名前で見る
 */
export const RESUME_DENY_COMMANDS: readonly string[] = [
  // ファイルを消す・上書きする
  "rm",
  "rmdir",
  "mv",
  "cp",
  "dd",
  "shred",
  "truncate",
  "trash",
  "ln",
  "chmod",
  "chown",
  "chgrp",
  "mkfs",
  "fdisk",
  "diskutil",
  "format",
  // 権限昇格・別のコマンドを実行させる
  "sudo",
  "doas",
  "su",
  "pkexec",
  "runas",
  "eval",
  "exec",
  "xargs",
  // プロセス・OSを止める
  "kill",
  "killall",
  "pkill",
  "taskkill",
  "reboot",
  "shutdown",
  "halt",
  "poweroff",
  // 作業ツリー・リモートを書き換えるgit操作
  "git push",
  "git pull",
  "git reset",
  "git clean",
  "git rebase",
  "git merge",
  "git commit",
  "git checkout",
  "git restore",
  "git switch",
  "git stash",
  "git cherry-pick",
  "git revert",
  "git am",
  "git apply",
  "git branch",
  "git tag",
  "git worktree",
  // 公開・デプロイ・削除
  "npm publish",
  "pnpm publish",
  "yarn publish",
  "bun publish",
  "cargo publish",
  "gh pr merge",
  "gh repo delete",
  "gh release",
  "kubectl delete",
  "terraform apply",
  "terraform destroy",
];

/**
 * シェルのクォート・エスケープを外して単語へ分ける。閉じていないクォートはnull。
 * 判定にだけ使う（打ち直すのは元のコマンド行そのもの）ので、展開（`$HOME`・`~`）はしない
 */
export function splitShellWords(line: string): string[] | null {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && i + 1 < line.length) current += line[++i];
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
      continue;
    }
    if (ch === "\\" && i + 1 < line.length) {
      current += line[++i];
      inWord = true;
      continue;
    }
    if (/\s/u.test(ch)) {
      if (inWord) words.push(current);
      current = "";
      inWord = false;
      continue;
    }
    current += ch;
    inWord = true;
  }
  if (quote !== null) return null;
  if (inWord) words.push(current);
  return words;
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/** パス付きの単語（`/usr/bin/nvim`・`C:\bin\rm.exe`）を名前だけにする。比較用 */
function commandName(word: string): string {
  const base = word.split(/[/\\]/u).pop() ?? word;
  return base.replace(/\.exe$/iu, "");
}

/** wordsのstart以降がpatternの単語列で始まるか。先頭の単語だけはパスを外して比べる */
function startsWithWords(words: readonly string[], start: number, pattern: readonly string[]) {
  if (start + pattern.length > words.length) return false;
  return pattern.every((p, i) => {
    const word = words[start + i] as string;
    return i === 0 ? commandName(word) === p : word === p;
  });
}

function toWords(entry: string): string[] {
  return entry
    .trim()
    .split(/\s+/u)
    .filter((w) => w !== "");
}

export type ResumeRejectReason = "empty" | "compound" | "unparsable" | "denied" | "not-allowed";

export type ResumeDecision =
  | { ok: true; command: string }
  | { ok: false; reason: ResumeRejectReason };

/**
 * 実行中だったコマンド行を打ち直してよいか判定する。打ち直すのは環境変数代入を含む元の行そのもの
 * （`CLAUDE_CONFIG_DIR=~/.x claude`の代入を落とすと別の設定で起動してしまうため）
 */
export function decideResumeCommand(line: string, allow: readonly string[]): ResumeDecision {
  const command = line.trim();
  if (command === "") return { ok: false, reason: "empty" };
  if (COMPOUND_MARKERS.some((marker) => command.includes(marker))) {
    return { ok: false, reason: "compound" };
  }
  const words = splitShellWords(command);
  if (words === null) return { ok: false, reason: "unparsable" };

  // クォートの中に空白区切りで別のコマンドが入る形（`bash -c "rm -rf x"`）も拾えるよう、
  // denyリストは単語をさらに空白で割った列に当てる
  const flatWords = words.flatMap((w) => w.split(/\s+/u)).filter((w) => w !== "");
  const denied = RESUME_DENY_COMMANDS.some((entry) => {
    const pattern = toWords(entry);
    return flatWords.some((_, i) => startsWithWords(flatWords, i, pattern));
  });
  if (denied) return { ok: false, reason: "denied" };

  let start = 0;
  while (start < words.length && ENV_ASSIGNMENT.test(words[start] as string)) start++;
  if (start === words.length) return { ok: false, reason: "empty" };
  const allowed = allow.some((entry) => {
    const pattern = toWords(entry);
    return pattern.length > 0 && startsWithWords(words, start, pattern);
  });
  if (!allowed) return { ok: false, reason: "not-allowed" };
  return { ok: true, command };
}

/** Boardの打ち直しの切り替え。nullは手動の切り替えが無く、設定に従う状態 */
export type BoardResumeOverride = boolean | null;

/**
 * レイアウトプリセットで組み直さないBoardで打ち直すか。手動の切り替え（CLI・サイドバー）が
 * 設定（resume.enabled）より優先される
 */
export function isBoardResumeEnabled(
  override: BoardResumeOverride,
  configEnabled: boolean,
): boolean {
  return override ?? configEnabled;
}

/**
 * レイアウトプリセットで組み直すBoardのタブで打ち直すか。手動の切り替え → タブのresume →
 * プリセットのresumeの順に優先し、どれも無ければ打ち直さない。プリセットのタブは自前のcommandを
 * 持つため、resume.enabled（既定true）を既定値にすると明示しなくてもcommandが上書きされてしまう
 */
export function isLayoutTabResumeEnabled(
  override: BoardResumeOverride,
  tabResume: boolean | undefined,
  presetResume: boolean | undefined,
): boolean {
  return override ?? tabResume ?? presetResume ?? false;
}
