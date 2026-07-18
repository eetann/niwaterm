// bun:ffi から libghostty-vt を呼び出す検証スクリプト
// 実行: bun run spike/libghostty-ffi/test.ts
import { dlopen, FFIType, type Pointer, ptr, read } from "bun:ffi";
import { join } from "node:path";

const libDir = join(import.meta.dir, "../../vendor/libghostty/lib");

const shim = dlopen(join(libDir, "libniwashim.dylib"), {
	niwa_terminal_new: {
		args: [FFIType.ptr, FFIType.u16, FFIType.u16, FFIType.u64],
		returns: FFIType.i32,
	},
	niwa_formatter_new: {
		args: [FFIType.ptr, FFIType.ptr],
		returns: FFIType.i32,
	},
});

const vt = dlopen(join(libDir, "libghostty-vt.dylib"), {
	ghostty_terminal_vt_write: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
		returns: FFIType.void,
	},
	ghostty_terminal_get: {
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

// GhosttyTerminalData enum
const DATA_COLS = 1;
const DATA_ROWS = 2;
const DATA_CURSOR_X = 3;
const DATA_CURSOR_Y = 4;

// 1. ターミナル作成 (80x24, scrollback 1000行)
const termHandleBuf = new BigUint64Array(1);
let rc = shim.symbols.niwa_terminal_new(ptr(termHandleBuf), 80, 24, 1000n);
if (rc !== 0) throw new Error(`ghostty_terminal_new failed: ${rc}`);
const term = read.ptr(ptr(termHandleBuf)) as Pointer;
console.log("✅ terminal created:", term);

// 2. VTシーケンスを書き込む（日本語・絵文字・SGR色付き）
const input = new TextEncoder().encode(
	"Hello from libghostty-vt!\r\nこんにちは世界 🌱\r\n\x1b[31mred text\x1b[0m done\r\n",
);
vt.symbols.ghostty_terminal_vt_write(term, ptr(input), BigInt(input.length));
console.log("✅ vt_write done:", input.length, "bytes");

// 3. ターミナル状態を読み出す
const u16out = new Uint16Array(1);
const results: Record<string, number> = {};
for (const [name, key] of [
	["cols", DATA_COLS],
	["rows", DATA_ROWS],
	["cursor_x", DATA_CURSOR_X],
	["cursor_y", DATA_CURSOR_Y],
] as const) {
	rc = vt.symbols.ghostty_terminal_get(term, key, ptr(u16out));
	if (rc !== 0) throw new Error(`ghostty_terminal_get(${name}) failed: ${rc}`);
	results[name] = u16out[0];
}
console.log("✅ terminal state:", results);

// 4. 画面内容をplain textで取り出す
const fmtHandleBuf = new BigUint64Array(1);
rc = shim.symbols.niwa_formatter_new(ptr(fmtHandleBuf), term);
if (rc !== 0) throw new Error(`formatter_new failed: ${rc}`);
const fmt = read.ptr(ptr(fmtHandleBuf)) as Pointer;

const outBuf = new Uint8Array(64 * 1024);
const writtenBuf = new BigUint64Array(1);
rc = vt.symbols.ghostty_formatter_format_buf(
	fmt,
	ptr(outBuf),
	BigInt(outBuf.length),
	ptr(writtenBuf),
);
if (rc !== 0) throw new Error(`format_buf failed: ${rc}`);
const written = Number(writtenBuf[0]);
const screenText = new TextDecoder().decode(outBuf.subarray(0, written));
console.log("✅ screen dump (plain text):");
console.log("---");
console.log(screenText);
console.log("---");

// 5. 後始末
vt.symbols.ghostty_formatter_free(fmt);
vt.symbols.ghostty_terminal_free(term);
console.log("✅ freed. all checks passed!");
