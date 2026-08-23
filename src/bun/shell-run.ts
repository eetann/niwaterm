// niwa.shell.run（tmuxのrun-shell相当）の実行基盤。PTYを使わないワンショットのシェルコマンド実行。
// OS/シェルの違い（wsl.exe/powershell.exe/zsh等）を吸収するラップ方法はpty.tsのcreatePtyと共有する
// （appendCommandArgs/shellCommand/buildEnv）。config.ts側にBun.spawnを直接書かせると、シェルごとの
// クォート・ログイン/インタラクティブ判定・WSLENV対応をユーザー自身が再実装する必要があり、
// ミスの温床になるため（詳細: .mywork/work-logs/2026-08-22-tab-respawn-command-non-login-shell-path-issue.md）。

import { homedir } from "node:os";
import { appendCommandArgs, buildEnv, shellCommand } from "./pty";
import { applyWslCdArg } from "./wsl-cwd";

export interface ShellRunOptions {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ShellRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runShellCommand(
  command: string,
  opts: ShellRunOptions,
): Promise<ShellRunResult> {
  const term = process.env["TERM"] ?? "xterm-256color";
  const cmd = shellCommand(opts.shell);
  const spawnCwd = applyWslCdArg(cmd, opts.cwd);
  appendCommandArgs(cmd, command, undefined);

  const proc = Bun.spawn(cmd, {
    cwd: spawnCwd ?? homedir(),
    env: buildEnv(cmd, term, opts.env),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}
