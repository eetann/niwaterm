// Windows起動時にインストール済みのWSLディストロ・PowerShellを自動検出し、シェルプロファイルとして提供する。
// macOS/Linuxでは自動検出対象が無いため常に空配列を返す（configのshell.profilesのみが有効）。

import type { ShellProfile } from "@niwaterm/config";

const isWindows = process.platform === "win32";

const POWERSHELL_PROFILE: ShellProfile = {
  id: "powershell",
  name: "PowerShell",
  command: "powershell.exe -NoLogo",
};

function toWslProfileId(distroName: string): string {
  return `wsl-${distroName.replace(/[^A-Za-z0-9_.-]/g, "-")}`;
}

/** サンプル区間の奇数バイトの大半が0x00ならUTF-16LEらしいと判定する（ASCII範囲の文字列が対象のため） */
function looksUtf16Le(bytes: Uint8Array): boolean {
  const sampleLen = Math.min(bytes.length, 40);
  if (sampleLen < 4) return false;
  let zeroOdd = 0;
  let count = 0;
  for (let i = 1; i < sampleLen; i += 2) {
    count++;
    if (bytes[i] === 0) zeroOdd++;
  }
  return count > 0 && zeroOdd / count > 0.5;
}

/**
 * wsl.exeの出力をデコードする。コンソールAPI由来でパイプ経由でもUTF-16LEになることがある既知の挙動
 * （BOM付き・無しいずれもありうる）のため、BOMまたはバイトパターンから判定してデコードする。
 * 実機（Windows）でしか最終確認できていない
 */
function decodeWslOutput(bytes: Uint8Array): string {
  const hasBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  if (hasBom) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (looksUtf16Le(bytes)) return new TextDecoder("utf-16le").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

/** 印字可能文字（コードポイント0x20未満の制御文字を除く）だけを残す */
function stripControlChars(line: string): string {
  let result = "";
  for (const ch of line) {
    if ((ch.codePointAt(0) ?? 0) >= 0x20) result += ch;
  }
  return result;
}

/** `wsl.exe --list --quiet`の出力からディストロ名を抽出し、シェルプロファイルへ変換する */
export function parseWslListOutput(bytes: Uint8Array): ShellProfile[] {
  const text = decodeWslOutput(bytes);
  const names = text
    .split(/\r?\n/)
    .map((line) => stripControlChars(line).trim())
    .filter((line) => line.length > 0);
  return names.map((name) => ({
    id: toWslProfileId(name),
    name: `WSL: ${name}`,
    command: `wsl.exe -d ${name}`,
  }));
}

export type ResolveShellProfileResult =
  | { ok: true; command: string | undefined }
  | { ok: false; error: string };

/**
 * shellProfileIdをshell.tsのcommand文字列に解決する。IDがundefinedならcommandもundefined
 * （デフォルトシェルへフォールバックする指示）。未知のIDはエラーを返す
 * （index.tsのRPCハンドラ・ipc-server.tsの/new-tab両方から共通で使う）
 */
export function resolveShellProfileCommand(
  profiles: ShellProfile[],
  shellProfileId: string | undefined,
): ResolveShellProfileResult {
  if (shellProfileId === undefined) return { ok: true, command: undefined };
  const profile = profiles.find((p) => p.id === shellProfileId);
  if (!profile) return { ok: false, error: `unknown shellProfileId: ${shellProfileId}` };
  return { ok: true, command: profile.command };
}

/**
 * Windows起動時にインストール済みのWSLディストロ・PowerShellをシェルプロファイルとして検出する。
 * macOS/Linuxでは検出対象が無いため常に空配列を返す。wsl.exe不在・実行失敗時もPowerShellプロファイルは
 * 返す（WSL未インストール環境でも起動を妨げないため）
 */
export async function detectShellProfiles(): Promise<ShellProfile[]> {
  if (!isWindows) return [];
  const profiles: ShellProfile[] = [POWERSHELL_PROFILE];
  try {
    const proc = Bun.spawn(["wsl.exe", "--list", "--quiet"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      profiles.push(...parseWslListOutput(bytes));
    }
  } catch (err) {
    console.log(`[bun] failed to detect WSL distros: ${String(err)}`);
  }
  return profiles;
}
