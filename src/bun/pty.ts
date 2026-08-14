// Bun.Terminal（Bun 1.3.5+）ベースのPTY実装。
// node-ptyと異なり、Bun Worker内でもTerminalのdata/exitコールバックが正常に発火する。
// WindowsではBun 1.3.14+が必要（ConPTY実装がそのバージョンから入った）。

import { homedir } from "node:os";
import { applyWslCdArg } from "./wsl-cwd";

const isWindows = process.platform === "win32";

export interface PtyOptions {
  /** 起動するシェルの実行コマンド。スペース区切りで単純分割される（クォート・エスケープ非対応）。省略時はOS標準シェル */
  shell?: string;
  cols: number;
  rows: number;
  cwd?: string;
  term?: string;
  /** 追加で設定する環境変数（process.envへ上書きマージする） */
  env?: Record<string, string>;
}

export interface Pty {
  readonly pid: number;
  onData(fn: (data: Uint8Array) => void): void;
  onExit(fn: (code: number) => void): void;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/**
 * 起動するシェルのコマンドライン。
 * Windowsにはログインシェルの概念が無いため、プロファイル読み込みは各シェルの既定に任せる。
 * shellはスペース区切りで単純分割する（クォート・エスケープ非対応）。WSLディストロ起動
 * （"wsl.exe -d Ubuntu"等）やシェルプロファイルの引数指定に対応するため
 */
function shellCommand(shell: string | undefined): string[] {
  if (shell) {
    const parts = shell.split(" ").filter((s) => s.length > 0);
    if (parts.length > 0) return parts;
  }
  return isWindows ? ["powershell.exe", "-NoLogo"] : ["/bin/zsh", "-il"];
}

/**
 * WSLは`wsl.exe`起動時にWindows側の環境変数を既定では継承しない
 * （`WSLENV`にコロン区切りで明示リストした変数名だけがLinux側へ渡る仕様）。
 * niwatermがPTY起動時に注入する変数（NIWATERM_TAB_ID等）をWSL内のシェルまで
 * 届けるため、WSLプロファイル起動時のみWSLENVへ追記する
 */
function buildEnv(
  cmd: string[],
  term: string,
  extraEnv: Record<string, string> | undefined,
): Record<string, string> {
  const env: Record<string, string> = { ...process.env, TERM: term, ...extraEnv };
  if (isWindows && extraEnv && cmd[0]?.toLowerCase() === "wsl.exe") {
    const existing = env["WSLENV"]?.split(":").filter((v) => v.length > 0) ?? [];
    env["WSLENV"] = [...new Set([...existing, ...Object.keys(extraEnv)])].join(":");
  }
  return env;
}

export function createPty(opts: PtyOptions): Pty {
  const term = opts.term ?? "xterm-256color";
  const cmd = shellCommand(opts.shell);

  // wsl.exeプロファイル起動時、Windows側のcwdをそのままBun.spawnへ渡すと
  // Linux側で/mnt/c/...等にマップされてしまうため、必要ならcmdへ--cdを追記する
  // （詳細: wsl-cwd.ts）
  const spawnCwd = applyWslCdArg(cmd, opts.cwd);

  let onDataFn: ((data: Uint8Array) => void) | null = null;
  let onExitFn: ((code: number) => void) | null = null;

  const terminal = new Bun.Terminal({
    cols: opts.cols,
    rows: opts.rows,
    name: term,
    data(_terminal, data) {
      onDataFn?.(data);
    },
  });

  const spawnOptions = {
    // TerminalOptions.nameはTERM環境変数を設定しないため明示的に渡す
    env: buildEnv(cmd, term, opts.env),
    terminal,
    onExit(_proc: Bun.Subprocess, exitCode: number | null) {
      onExitFn?.(exitCode ?? 0);
    },
  };

  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(cmd, { ...spawnOptions, cwd: spawnCwd ?? homedir() });
  } catch (err) {
    // uv_spawnのENOENTはcwd不在・実行ファイル不在いずれでも発生し、エラー自体からは
    // 区別できない（libuv/Windowsの既知の癖）。spawnCwdを明示指定していた場合は
    // cwd起因（例: WSL側CLIから渡されたパスがWindows側に存在しない）を疑い、
    // homedir()へフォールバックして再試行する。フォールバックでも失敗する場合は
    // シェルコマンド自体の問題とみなしそのまま投げる
    if (spawnCwd === undefined) throw err;
    console.log(
      `[bun] failed to spawn pty with cwd=${spawnCwd}, falling back to home directory: ${String(err)}`,
    );
    proc = Bun.spawn(cmd, { ...spawnOptions, cwd: homedir() });
  }

  function onData(fn: (data: Uint8Array) => void): void {
    onDataFn = fn;
  }

  function onExit(fn: (code: number) => void): void {
    onExitFn = fn;
  }

  function write(data: string | Uint8Array): void {
    terminal.write(data);
    // Bun.Terminal.write()はptyのline discipline処理（ISIG検知によるシグナル生成）を
    // バイパスするため、Ctrl+C(ETX, 0x03)を書き込むだけではSIGINTが生成されない。
    // フォアグラウンドプロセスグループへ直接送ることで代替する。
    // Windowsにはプロセスグループが無く、ConPTYがCtrl+Cをコンソール入力として解釈するため不要。
    if (!isWindows && data === "\x03") {
      try {
        process.kill(-proc.pid, "SIGINT");
      } catch {}
    }
  }

  function resize(cols: number, rows: number): void {
    terminal.resize(cols, rows);
    // Bun.Terminal.resize()はwinsize（TIOCSWINSZ相当）は更新するが、
    // SIGWINCHをフォアグラウンドプロセスグループへ送出しない。
    // このためシェルの$COLUMNS等リサイズ通知に依存する値が更新されず、
    // プロンプト側の罫線幅計算などが古いサイズのまま固着する。
    // Windowsにはプロセスグループもシグナルも無く、ConPTY側がサイズ変更を子へ通知する。
    if (isWindows) return;
    try {
      process.kill(-proc.pid, "SIGWINCH");
    } catch {}
  }

  function kill(): void {
    // terminal.close()でPTYマスター側を閉じ、シェル側にSIGHUPを送って終了させる。
    // proc.kill()（SIGTERM）だけでは対話型シェルが無視し、プロセスが残り続けることがある。
    terminal.close();
    proc.kill();
  }

  return { pid: proc.pid, onData, onExit, write, resize, kill };
}
