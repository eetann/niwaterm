// Bun.Terminal（Bun 1.3.5+）ベースのPTY実装。
// node-ptyと異なり、Bun Worker内でもTerminalのdata/exitコールバックが正常に発火する。

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

  const proc = Bun.spawn([opts.shell ?? "/bin/zsh", "-il"], {
    cwd: opts.cwd ?? process.env["HOME"] ?? "/",
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
  }

  function resize(cols: number, rows: number): void {
    terminal.resize(cols, rows);
  }

  function kill(): void {
    // terminal.close()でPTYマスター側を閉じ、シェル側にSIGHUPを送って終了させる。
    // proc.kill()（SIGTERM）だけでは対話型シェルが無視し、プロセスが残り続けることがある。
    terminal.close();
    proc.kill();
  }

  return { pid: proc.pid, onData, onExit, write, resize, kill };
}
