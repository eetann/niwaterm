// プロジェクトローカル設定（<repoRoot>/.niwaterm/config.ts）を評価してよいかの承認。
//
// この設定はリポジトリにコミットされることを想定しているため、cloneしてきたリポジトリで
// worktree系のコマンドを叩くと、他人が書いたTypeScriptがこちらのマシンで動くことになる。
// importした時点でトップレベルのコードが走るので、承認は**importの前**に取る。承認できていない
// リポジトリではプロジェクトローカル設定を一切読まず、グローバル設定とgit configだけで解決する。
//
// レイアウトプリセットの適用（worktree/open.ts）も同じ承認で門番する。プリセットの解決は
// アプリ側が<repoRoot>/.niwaterm/config.tsを評価して行うため、CLIがimportしなくてもコードは走る。
// 適用したプリセットは起動時レイアウトとしても紐づき、以後は起動のたびにcommandが走るので、
// その点まで承認の文面で断ってこの承認1本にまとめる（layout-trust.tsの確認を重ねて出さない）。
//
// 承認の記録はレイアウトプリセット（layout-trust.ts）と違って専用ストアを持つ。あちらは
// 「起動時レイアウトの紐づけ」という永続オブジェクトがそのまま信頼の記録になるが、
// worktreeのフックには対応する紐づけが無いため。
//
// 記録の鍵は「リポジトリのパス + .niwaterm/配下の内容のハッシュ」にする（gtrのtrustと同じ考え方）。
// 内容が変わると鍵も変わるので、承認後にフックを書き換えられても黙って実行されることはない。
// ただし.niwaterm/の外をimportしている場合（`../scripts/setup.ts`等）、その変更は検出できない。

import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

/** プロジェクトルート直下に置く設定ディレクトリ名（src/bun/project-config.tsと同じ値） */
export const PROJECT_CONFIG_DIR_NAME = ".niwaterm";

/** 承認記録の既定の置き場所 */
export function defaultTrustDirPath(): string {
  return join(homedir(), ".config", "niwaterm", "trusted-projects");
}

/** ディレクトリ配下のファイルを相対パス昇順で集める。node_modulesは巨大になりうるので見ない */
async function collectFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(dir, entry.name);
    // シンボリックリンクはisDirectory()がリンク先を見ないため、statで実体の種別を判定する
    const isDir = entry.isSymbolicLink()
      ? ((await stat(path).catch(() => null))?.isDirectory() ?? false)
      : entry.isDirectory();
    if (isDir) files.push(...(await collectFiles(path, rel)));
    else files.push(rel);
  }
  return files.sort();
}

/**
 * .niwaterm/配下の内容から承認の鍵を作る。ディレクトリが無ければnull。
 * パスも混ぜるのは、同じ内容の設定を別リポジトリへコピーしても改めて承認を取るため
 */
export async function projectTrustKey(repoRoot: string): Promise<string | null> {
  const dir = join(repoRoot, PROJECT_CONFIG_DIR_NAME);
  let files: string[];
  try {
    files = await collectFiles(dir);
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const hasher = createHash("sha256");
  hasher.update(repoRoot);
  for (const file of files) {
    hasher.update("\0");
    hasher.update(file);
    hasher.update("\0");
    hasher.update(new Uint8Array(await Bun.file(join(dir, file)).arrayBuffer()));
  }
  return hasher.digest("hex");
}

async function isTrusted(trustDir: string, key: string): Promise<boolean> {
  return await Bun.file(join(trustDir, key)).exists();
}

async function recordTrust(trustDir: string, key: string, repoRoot: string): Promise<void> {
  // 中身は人がストアを覗いたときに何のリポジトリか分かるようにするためだけのもの。
  // 判定に使うのはファイル名（鍵）だけ
  await Bun.write(join(trustDir, key), `${repoRoot}\n`);
}

/**
 * 承認の判定結果。
 * - absent: プロジェクトローカル設定が無い（承認の話が発生しない）
 * - trusted: 読んでよい
 * - declined: 読まない（拒否された・非対話で確認できなかった）
 */
export type ProjectTrustDecision = "absent" | "trusted" | "declined";

export interface EnsureProjectTrustOptions {
  /** --trust相当。確認を省いて承認済みとして扱い、記録も残す */
  assumeTrusted: boolean;
  /**
   * 承認記録の置き場所。省略時はdefaultTrustDirPath()。
   * homedir()はHOME環境変数を見ないため、テストから差し替えるにはここで渡す
   */
  trustDir?: string;
}

/** y/Nで承認を取る。非対話環境では確認できないので拒否として扱う */
async function confirm(repoRoot: string): Promise<boolean> {
  const path = join(repoRoot, PROJECT_CONFIG_DIR_NAME, "config.ts");
  console.log("このリポジトリはniwatermのプロジェクトローカル設定を持っています:");
  console.log(`  ${path}`);
  console.log(
    "ワークツリーの操作でこのファイルが評価され、worktree.onCreateのフックやlayoutsのプリセットに書かれたコマンドが実行されます。",
  );
  console.log(
    "レイアウトプリセットを適用したBoardは起動時レイアウトとしても紐づくため、以後niwatermを起動するたびにも実行されます。",
  );
  console.log("信頼できるリポジトリでのみ許可してください。");
  if (!process.stdin.isTTY) {
    console.error(
      "非対話環境のため確認できません。プロジェクトローカル設定を無視して続行します（--trustで承認をスキップできます）",
    );
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question("このリポジトリを信頼しますか？ (y/N) ")).trim());
  } finally {
    rl.close();
  }
}

/**
 * プロジェクトローカル設定を読んでよいかを決める。未承認なら確認を取り、承認されたら記録する。
 * **この関数を通す前にプロジェクトローカル設定をimportしてはいけない**（importでコードが走るため）
 */
export async function ensureProjectTrust(
  repoRoot: string,
  opts: EnsureProjectTrustOptions,
): Promise<ProjectTrustDecision> {
  const key = await projectTrustKey(repoRoot);
  if (key === null) return "absent";
  const trustDir = opts.trustDir ?? defaultTrustDirPath();
  if (await isTrusted(trustDir, key)) return "trusted";
  if (!opts.assumeTrusted && !(await confirm(repoRoot))) return "declined";
  await recordTrust(trustDir, key, repoRoot);
  return "trusted";
}
