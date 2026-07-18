// libghostty-vt の bun:ffi バインディング
import {
	dlopen,
	FFIType,
	JSCallback,
	type Pointer,
	ptr,
	read,
	toArrayBuffer,
} from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// ビルド成果物(build/内)から実行されるため、repoルートのvendorを上方向に探索する
function findLibDir(): string {
	let dir = process.cwd();
	for (let i = 0; i < 10; i++) {
		const candidate = join(dir, "vendor/libghostty/lib");
		if (existsSync(join(candidate, "libghostty-vt.dylib"))) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(
		"vendor/libghostty/lib が見つからない。`bun run build:native` の前に libghostty-vt をビルドすること",
	);
}

export const libDir = findLibDir();

const shim = dlopen(join(libDir, "libniwashim.dylib"), {
	niwa_terminal_new: {
		args: [FFIType.ptr, FFIType.u16, FFIType.u16, FFIType.u64],
		returns: FFIType.i32,
	},
	niwa_formatter_new: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.i32],
		returns: FFIType.i32,
	},
});

const vt = dlopen(join(libDir, "libghostty-vt.dylib"), {
	ghostty_terminal_vt_write: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
		returns: FFIType.void,
	},
	ghostty_terminal_resize: {
		args: [FFIType.ptr, FFIType.u16, FFIType.u16, FFIType.u32, FFIType.u32],
		returns: FFIType.i32,
	},
	ghostty_terminal_get: {
		args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
		returns: FFIType.i32,
	},
	ghostty_terminal_set: {
		args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
		returns: FFIType.i32,
	},
	ghostty_terminal_free: {
		args: [FFIType.ptr],
		returns: FFIType.void,
	},
	ghostty_formatter_format_buf: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
		returns: FFIType.i32,
	},
	ghostty_formatter_free: {
		args: [FFIType.ptr],
		returns: FFIType.void,
	},
});

// GhosttyTerminalOption
const OPT_WRITE_PTY = 1;

// GhosttyTerminalData
const DATA_CURSOR_X = 3;
const DATA_CURSOR_Y = 4;
const DATA_CURSOR_VISIBLE = 7;

// GhosttyFormatterFormat
const FORMAT_HTML = 2;

export interface CursorState {
	x: number;
	y: number;
	visible: boolean;
}

export class GhosttyTerminal {
	#term: Pointer;
	#formatter: Pointer;
	#writePtyCallback: JSCallback | null = null;
	#formatBuf = new Uint8Array(256 * 1024);
	#writtenBuf = new BigUint64Array(1);
	#u16Out = new Uint16Array(1);
	#u8Out = new Uint8Array(1);

	constructor(cols: number, rows: number, maxScrollback = 10_000) {
		const handle = new BigUint64Array(1);
		let rc = shim.symbols.niwa_terminal_new(
			ptr(handle),
			cols,
			rows,
			BigInt(maxScrollback),
		);
		if (rc !== 0) throw new Error(`ghostty_terminal_new failed: ${rc}`);
		this.#term = read.ptr(ptr(handle)) as Pointer;

		rc = shim.symbols.niwa_formatter_new(ptr(handle), this.#term, FORMAT_HTML);
		if (rc !== 0) throw new Error(`ghostty_formatter_new failed: ${rc}`);
		this.#formatter = read.ptr(ptr(handle)) as Pointer;
	}

	/** DSR等のクエリ応答をPTYへ書き戻すコールバックを登録する */
	onWritePty(fn: (data: Uint8Array) => void): void {
		this.#writePtyCallback = new JSCallback(
			(
				_term: Pointer,
				_userdata: Pointer,
				data: Pointer,
				len: number | bigint,
			) => {
				const n = Number(len);
				if (n > 0) fn(new Uint8Array(toArrayBuffer(data, 0, n)).slice());
			},
			{
				args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64],
				returns: FFIType.void,
			},
		);
		vt.symbols.ghostty_terminal_set(
			this.#term,
			OPT_WRITE_PTY,
			this.#writePtyCallback.ptr,
		);
	}

	write(data: Uint8Array): void {
		if (data.length === 0) return;
		vt.symbols.ghostty_terminal_vt_write(
			this.#term,
			ptr(data),
			BigInt(data.length),
		);
	}

	resize(
		cols: number,
		rows: number,
		cellWidthPx: number,
		cellHeightPx: number,
	): void {
		vt.symbols.ghostty_terminal_resize(
			this.#term,
			cols,
			rows,
			Math.round(cellWidthPx),
			Math.round(cellHeightPx),
		);
	}

	cursor(): CursorState {
		vt.symbols.ghostty_terminal_get(
			this.#term,
			DATA_CURSOR_X,
			ptr(this.#u16Out),
		);
		const x = this.#u16Out[0] ?? 0;
		vt.symbols.ghostty_terminal_get(
			this.#term,
			DATA_CURSOR_Y,
			ptr(this.#u16Out),
		);
		const y = this.#u16Out[0] ?? 0;
		vt.symbols.ghostty_terminal_get(
			this.#term,
			DATA_CURSOR_VISIBLE,
			ptr(this.#u8Out),
		);
		return { x, y, visible: this.#u8Out[0] !== 0 };
	}

	/** 現在の画面をHTML文字列として取り出す */
	dumpHtml(): string {
		for (;;) {
			const rc = vt.symbols.ghostty_formatter_format_buf(
				this.#formatter,
				ptr(this.#formatBuf),
				BigInt(this.#formatBuf.length),
				ptr(this.#writtenBuf),
			);
			const written = Number(this.#writtenBuf[0]);
			if (rc === 0) {
				return new TextDecoder().decode(this.#formatBuf.subarray(0, written));
			}
			if (written > this.#formatBuf.length) {
				this.#formatBuf = new Uint8Array(written + 1024);
				continue;
			}
			throw new Error(`ghostty_formatter_format_buf failed: ${rc}`);
		}
	}

	free(): void {
		vt.symbols.ghostty_formatter_free(this.#formatter);
		vt.symbols.ghostty_terminal_free(this.#term);
		this.#writePtyCallback?.close();
	}
}
