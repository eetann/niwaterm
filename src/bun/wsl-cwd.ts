// OSC 7等でWSLディストロのシェルから報告されたcwd（Linuxパス）を、Windows側の
// Bun.spawnが解釈できるUNC形式（\\wsl.localhost\<distro>\...）へ変換する。
// packages/cli/src/ipc-client.tsのtoWindowsAccessibleCwdと同種の変換だが、あちらは
// 「CLIプロセス自身がWSL内で動いているか（WSL_DISTRO_NAME環境変数）」で判定するのに対し、
// こちらは「対象タブがwsl.exe系プロファイルで起動されたか」で判定する
// （bunメインプロセスは複数の異なるWSLディストロのタブを同時に持ちうるため、判定基準が異なる）。

const WSL_COMMAND_PATTERN = /^wsl\.exe\s+-d\s+(\S+)/i;

/** シェル起動コマンド文字列（例: "wsl.exe -d NixOS"）からWSLディストロ名を抽出する。WSLプロファイルでなければnull */
export function extractWslDistro(shellCommand: string | undefined): string | null {
  if (!shellCommand) return null;
  return WSL_COMMAND_PATTERN.exec(shellCommand.trim())?.[1] ?? null;
}

/**
 * タブが報告したcwdを、そのタブの起動シェルに応じて必要ならUNC形式へ変換する。
 * platform省略時はprocess.platformを使う（テストでWindows分岐を注入できるよう引数化している）。
 */
export function resolveActualCwd(
  rawCwd: string,
  shellCommand: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32" || !rawCwd.startsWith("/")) return rawCwd;
  const distro = extractWslDistro(shellCommand);
  if (!distro) return rawCwd;
  return `\\\\wsl.localhost\\${distro}${rawCwd.replaceAll("/", "\\")}`;
}

/**
 * PTY起動コマンド（cmd配列、例: ["wsl.exe", "-d", "NixOS"]）がwsl.exe系プロファイルの場合、
 * 必要なら`--cd`引数を追記した上で、Bun.spawnへ渡すべきcwd（Windows側のパス）を返す。
 * wsl.exeはBun.spawnのcwd（Windows側のパス）をそのままLinux側の/mnt/c/...等として
 * マップしてしまうため、Linux側のパス（cwd省略時はホームディレクトリ、または/始まりの
 * 明示指定）を使わせるには`--cd`で明示する必要がある。既にUNC形式（\\wsl.localhost\...）
 * へ変換済みのcwd（resolveActualCwd、前タブからの継承）はWindows側のパスとしてそのまま
 * 解決できるため対象外（そのままBun.spawnのcwdへ渡してよい）。
 * cmdは対象時のみ`--cd`引数を追記して変更される（副作用あり）。
 */
export function applyWslCdArg(
  cmd: string[],
  cwd: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "win32") return cwd;
  if (!extractWslDistro(cmd.join(" "))) return cwd;
  if (cwd !== undefined && !cwd.startsWith("/")) return cwd;
  cmd.push("--cd", cwd ?? "~");
  return undefined;
}
