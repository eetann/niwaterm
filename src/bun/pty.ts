// Cシム(forkpty)ベースのPTY実装。
// node-ptyはBun Worker内（Electrobunのアプリ実行環境）でonDataが発火しないため自前で持つ。
import { dlopen, FFIType, ptr } from "bun:ffi";
import { read as fsRead, write as fsWrite } from "node:fs";
import { join } from "node:path";
import { libDir } from "./ghostty";

const shim = dlopen(join(libDir, "libniwashim.dylib"), {
  niwa_pty_spawn: {
    args: [FFIType.ptr, FFIType.u16, FFIType.u16, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  niwa_pty_resize: {
    args: [FFIType.i32, FFIType.u16, FFIType.u16],
    returns: FFIType.i32,
  },
  niwa_pty_check_exit: {
    args: [FFIType.i32],
    returns: FFIType.i32,
  },
  niwa_pty_kill: {
    args: [FFIType.i32],
    returns: FFIType.i32,
  },
});

function cstr(s: string): Buffer {
  return Buffer.from(`${s}\0`, "utf8");
}

export interface PtyOptions {
  shell?: string;
  cols: number;
  rows: number;
  cwd?: string;
  term?: string;
}

export interface Pty {
  readonly pid: number;
  readonly fd: number;
  onData(fn: (data: Uint8Array) => void): void;
  onExit(fn: (code: number) => void): void;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export function createPty(opts: PtyOptions): Pty {
  const fdBuf = new Int32Array(1);
  const pid = shim.symbols.niwa_pty_spawn(
    ptr(fdBuf),
    opts.cols,
    opts.rows,
    ptr(cstr(opts.shell ?? "/bin/zsh")),
    ptr(cstr(opts.cwd ?? process.env["HOME"] ?? "/")),
    ptr(cstr(opts.term ?? "xterm-256color")),
  );
  if (pid < 0) throw new Error("niwa_pty_spawn failed");
  const fd = fdBuf[0] ?? -1;

  let onDataFn: ((data: Uint8Array) => void) | null = null;
  let onExitFn: ((code: number) => void) | null = null;
  let closed = false;
  const readBuf = Buffer.alloc(64 * 1024);

  function onData(fn: (data: Uint8Array) => void): void {
    onDataFn = fn;
  }

  function onExit(fn: (code: number) => void): void {
    onExitFn = fn;
  }

  function write(data: string | Uint8Array): void {
    if (closed) return;
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    fsWrite(fd, buf, (err) => {
      if (err) console.error("pty write error:", err.message);
    });
  }

  function resize(cols: number, rows: number): void {
    if (closed) return;
    shim.symbols.niwa_pty_resize(fd, cols, rows);
  }

  function kill(): void {
    if (closed) return;
    shim.symbols.niwa_pty_kill(pid);
  }

  function readLoop(): void {
    fsRead(fd, readBuf, 0, readBuf.length, null, (err, n) => {
      if (closed) return;
      if (err || n === 0) {
        // シェル終了時はEIOで読み取りが失敗する
        handleExit();
        return;
      }
      onDataFn?.(new Uint8Array(readBuf.subarray(0, n)));
      readLoop();
    });
  }

  function handleExit(attempt = 0): void {
    const code = shim.symbols.niwa_pty_check_exit(pid);
    if (code < 0 && attempt < 20) {
      setTimeout(() => handleExit(attempt + 1), 50);
      return;
    }
    closed = true;
    onExitFn?.(code < 0 ? 0 : code);
  }

  readLoop();

  return { pid, fd, onData, onExit, write, resize, kill };
}
