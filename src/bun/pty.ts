// Cシム(forkpty)ベースのPTY実装。
// node-ptyはBun Worker内（Electrobunのアプリ実行環境）でonDataが発火しないため自前で持つ。
import { dlopen, FFIType, ptr } from "bun:ffi";
import { read as fsRead, write as fsWrite } from "node:fs";
import { join } from "node:path";
import { libDir } from "./ghostty";

const shim = dlopen(join(libDir, "libniwashim.dylib"), {
	niwa_pty_spawn: {
		args: [
			FFIType.ptr,
			FFIType.u16,
			FFIType.u16,
			FFIType.ptr,
			FFIType.ptr,
			FFIType.ptr,
		],
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

export class Pty {
	readonly pid: number;
	readonly fd: number;
	#onData: ((data: Uint8Array) => void) | null = null;
	#onExit: ((code: number) => void) | null = null;
	#closed = false;
	#readBuf = Buffer.alloc(64 * 1024);

	constructor(opts: PtyOptions) {
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
		this.pid = pid;
		this.fd = fdBuf[0] ?? -1;
		this.#readLoop();
	}

	onData(fn: (data: Uint8Array) => void): void {
		this.#onData = fn;
	}

	onExit(fn: (code: number) => void): void {
		this.#onExit = fn;
	}

	write(data: string | Uint8Array): void {
		if (this.#closed) return;
		const buf =
			typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
		fsWrite(this.fd, buf, (err) => {
			if (err) console.error("pty write error:", err.message);
		});
	}

	resize(cols: number, rows: number): void {
		if (this.#closed) return;
		shim.symbols.niwa_pty_resize(this.fd, cols, rows);
	}

	kill(): void {
		if (this.#closed) return;
		shim.symbols.niwa_pty_kill(this.pid);
	}

	#readLoop(): void {
		fsRead(this.fd, this.#readBuf, 0, this.#readBuf.length, null, (err, n) => {
			if (this.#closed) return;
			if (err || n === 0) {
				// シェル終了時はEIOで読み取りが失敗する
				this.#handleExit();
				return;
			}
			this.#onData?.(new Uint8Array(this.#readBuf.subarray(0, n)));
			this.#readLoop();
		});
	}

	#handleExit(attempt = 0): void {
		const code = shim.symbols.niwa_pty_check_exit(this.pid);
		if (code < 0 && attempt < 20) {
			setTimeout(() => this.#handleExit(attempt + 1), 50);
			return;
		}
		this.#closed = true;
		this.#onExit?.(code < 0 ? 0 : code);
	}
}
