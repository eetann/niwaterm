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
