// Bun.Terminal（Bun 1.3.5+）ベースのPTY実装。
// node-ptyと異なり、Bun Worker内でもTerminalのdata/exitコールバックが正常に発火する。
// WindowsではBun 1.3.14+が必要（ConPTY実装がそのバージョンから入った）。

import { homedir } from "node:os";

const isWindows = process.platform === "win32";

export interface PtyOptions {
  shell?: string;
  cols: number;
  rows: number;
  cwd?: string;
  term?: string;
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
 */
function shellCommand(shell: string | undefined): string[] {
  if (isWindows) return shell ? [shell] : ["powershell.exe", "-NoLogo"];
  return [shell ?? "/bin/zsh", "-il"];
}

export function createPty(opts: PtyOptions): Pty {
  const term = opts.term ?? "xterm-256color";

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

  const proc = Bun.spawn(shellCommand(opts.shell), {
    cwd: opts.cwd ?? homedir(),
    // TerminalOptions.nameはTERM環境変数を設定しないため明示的に渡す
    env: { ...process.env, TERM: term },
    terminal,
    onExit(_proc, exitCode) {
      onExitFn?.(exitCode ?? 0);
    },
  });

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
