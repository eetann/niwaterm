// libghostty-vt の bun:ffi バインディング
import { dlopen, FFIType, JSCallback, type Pointer, ptr, read, toArrayBuffer } from "bun:ffi";
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
  ghostty_terminal_mode_get: {
    args: [FFIType.ptr, FFIType.u16, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_paste_encode: {
    args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
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
const OPT_CLIPBOARD_WRITE = 26;

// GhosttyMode（bit0-14=値, bit15=ANSIフラグ。2004はDEC privateなのでフラグなし）
const MODE_BRACKETED_PASTE = 2004;

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
  #clipboardCallback: JSCallback | null = null;
  #formatBuf = new Uint8Array(256 * 1024);
  #writtenBuf = new BigUint64Array(1);
  #u16Out = new Uint16Array(1);
  #u8Out = new Uint8Array(1);

  constructor(cols: number, rows: number, maxScrollback = 10_000) {
    const handle = new BigUint64Array(1);
    let rc = shim.symbols.niwa_terminal_new(ptr(handle), cols, rows, BigInt(maxScrollback));
    if (rc !== 0) throw new Error(`ghostty_terminal_new failed: ${rc}`);
    this.#term = read.ptr(ptr(handle)) as Pointer;

    rc = shim.symbols.niwa_formatter_new(ptr(handle), this.#term, FORMAT_HTML);
    if (rc !== 0) throw new Error(`ghostty_formatter_new failed: ${rc}`);
    this.#formatter = read.ptr(ptr(handle)) as Pointer;
  }

  /** DSR等のクエリ応答をPTYへ書き戻すコールバックを登録する */
  onWritePty(fn: (data: Uint8Array) => void): void {
    this.#writePtyCallback = new JSCallback(
      (_term: Pointer, _userdata: Pointer, data: Pointer, len: number | bigint) => {
        const n = Number(len);
        if (n > 0) fn(new Uint8Array(toArrayBuffer(data, 0, n)).slice());
      },
      {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64],
        returns: FFIType.void,
      },
    );
    vt.symbols.ghostty_terminal_set(this.#term, OPT_WRITE_PTY, this.#writePtyCallback.ptr);
  }

  /**
   * OSC 52等によるクリップボード書き込みを受けるコールバックを登録する。
   * fnにはtext/plain表現のバイト列を渡す（text/plainがなければ先頭の表現）。
   */
  onClipboardWrite(fn: (data: Uint8Array) => void): void {
    // GhosttyClipboardWrite { size_t size; i32 location; GhosttyClipboardContent* contents; size_t contents_len }
    // GhosttyClipboardContent { GhosttyString mime; GhosttyString data } / GhosttyString { ptr; size_t len } = 32バイト
    this.#clipboardCallback = new JSCallback(
      (_term: Pointer, _userdata: Pointer, writePtr: Pointer) => {
        const contents = read.ptr(writePtr, 16) as Pointer;
        const len = Number(read.u64(writePtr, 24));
        if (!contents || len === 0) return 0; // SUCCESS（クリアは無視）
        let chosen = 0;
        for (let i = 0; i < len; i++) {
          const mimePtr = read.ptr(contents, i * 32) as Pointer;
          const mimeLen = Number(read.u64(contents, i * 32 + 8));
          if (!mimePtr) continue;
          const mime = new TextDecoder().decode(new Uint8Array(toArrayBuffer(mimePtr, 0, mimeLen)));
          if (mime === "text/plain") {
            chosen = i;
            break;
          }
        }
        const dataPtr = read.ptr(contents, chosen * 32 + 16) as Pointer;
        const dataLen = Number(read.u64(contents, chosen * 32 + 24));
        if (dataPtr && dataLen > 0) {
          fn(new Uint8Array(toArrayBuffer(dataPtr, 0, dataLen)).slice());
        }
        return 0; // GHOSTTY_CLIPBOARD_WRITE_RESULT_SUCCESS
      },
      {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32,
      },
    );
    vt.symbols.ghostty_terminal_set(this.#term, OPT_CLIPBOARD_WRITE, this.#clipboardCallback.ptr);
  }

  /** bracketed pasteモード（DEC 2004）が有効か */
  bracketedPaste(): boolean {
    const rc = vt.symbols.ghostty_terminal_mode_get(
      this.#term,
      MODE_BRACKETED_PASTE,
      ptr(this.#u8Out),
    );
    return rc === 0 && this.#u8Out[0] !== 0;
  }

  /** ペースト文字列をPTY書き込み用に整形する（危険バイト除去 + bracketed paste包み） */
  encodePaste(text: string): Uint8Array {
    if (text.length === 0) return new Uint8Array(0);
    const bracketed = this.bracketedPaste();
    // ghostty_paste_encodeは入力をin-placeで書き換えるため毎回コピーを渡す
    const src = new TextEncoder().encode(text);
    let buf = new Uint8Array(src.length + 16);
    for (;;) {
      const data = src.slice();
      const rc = vt.symbols.ghostty_paste_encode(
        ptr(data),
        BigInt(data.length),
        bracketed,
        ptr(buf),
        BigInt(buf.length),
        ptr(this.#writtenBuf),
      );
      const written = Number(this.#writtenBuf[0]);
      if (rc === 0) return buf.subarray(0, written);
      if (written > buf.length) {
        buf = new Uint8Array(written);
        continue;
      }
      throw new Error(`ghostty_paste_encode failed: ${rc}`);
    }
  }

  write(data: Uint8Array): void {
    if (data.length === 0) return;
    vt.symbols.ghostty_terminal_vt_write(this.#term, ptr(data), BigInt(data.length));
  }

  resize(cols: number, rows: number, cellWidthPx: number, cellHeightPx: number): void {
    vt.symbols.ghostty_terminal_resize(
      this.#term,
      cols,
      rows,
      Math.round(cellWidthPx),
      Math.round(cellHeightPx),
    );
  }

  cursor(): CursorState {
    vt.symbols.ghostty_terminal_get(this.#term, DATA_CURSOR_X, ptr(this.#u16Out));
    const x = this.#u16Out[0] ?? 0;
    vt.symbols.ghostty_terminal_get(this.#term, DATA_CURSOR_Y, ptr(this.#u16Out));
    const y = this.#u16Out[0] ?? 0;
    vt.symbols.ghostty_terminal_get(this.#term, DATA_CURSOR_VISIBLE, ptr(this.#u8Out));
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
    this.#clipboardCallback?.close();
  }
}
