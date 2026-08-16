// libghostty-vt の bun:ffi バインディング
import { dlopen, FFIType, JSCallback, type Pointer, ptr, read, toArrayBuffer } from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// ネイティブ成果物の配置と命名はプラットフォームで異なる。
// zigはWindowsのみDLL本体をbin/へ出す（lib/に入るのはリンク用のインポートライブラリ）
const nativeLayout =
  process.platform === "win32"
    ? { subdir: "bin", vt: "ghostty-vt.dll", shim: "niwashim.dll" }
    : { subdir: "lib", vt: "libghostty-vt.dylib", shim: "libniwashim.dylib" };

const libSubdir = join("vendor/libghostty", nativeLayout.subdir);

// ビルド成果物(build/内)から実行されるため、repoルートのvendorを上方向に探索する
function findLibDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, libSubdir);
    if (existsSync(join(candidate, nativeLayout.vt))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `${libSubdir} が見つからない。\`bun run build:native\` の前に libghostty-vt をビルドすること`,
  );
}

export const libDir = findLibDir();

// shimはghostty-vtに依存する。WindowsのローダーはDLL自身と同じディレクトリを
// 依存DLLの探索対象にしない（macOSの@loader_path rpathに相当するものが無い）ため、
// shimを先に開くとERROR_MOD_NOT_FOUND(126)で失敗する。
// 先にghostty-vtを開いてプロセスにロード済みにしておくと、名前解決がそちらに当たって解決する
const vt = dlopen(join(libDir, nativeLayout.vt), {
  ghostty_terminal_new: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u16, FFIType.u16],
    returns: FFIType.i32,
  },
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
  ghostty_paste_encode: {
    args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
});

const shim = dlopen(join(libDir, nativeLayout.shim), {
  niwa_dump_screen: {
    args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  niwa_scroll_viewport: {
    args: [FFIType.ptr, FFIType.i32, FFIType.i64],
    returns: FFIType.void,
  },
});

// GhosttyTerminalOption
const OPT_WRITE_PTY = 1;
const OPT_CLIPBOARD_WRITE = 26;
const OPT_SCROLLBACK_MAX_LINES = 28;
const OPT_PWD_CHANGED = 25;

// GhosttyMode = uint16_t（bit0-14=値, bit15=ANSIフラグ。2004はDEC privateなのでフラグなし）
const MODE_BRACKETED_PASTE = 2004;

// GhosttyTerminalData
const DATA_CURSOR_X = 3;
const DATA_CURSOR_Y = 4;
const DATA_CURSOR_VISIBLE = 7;
const DATA_VIEWPORT_ACTIVE = 32;
const DATA_MODE = 37;
const DATA_PWD = 13;

// GhosttyFormatterFormat
const FORMAT_PLAIN = 0;
const FORMAT_HTML = 2;

// GhosttyTerminalScrollViewportTag
const SCROLL_VIEWPORT_TOP = 0;
const SCROLL_VIEWPORT_BOTTOM = 1;
const SCROLL_VIEWPORT_DELTA = 2;

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
}

export function createGhosttyTerminal(cols: number, rows: number, maxScrollback = 10_000) {
  const handle = new BigUint64Array(1);
  let rc = vt.symbols.ghostty_terminal_new(null, ptr(handle), cols, rows);
  if (rc !== 0) throw new Error(`ghostty_terminal_new failed: ${rc}`);
  const term = read.ptr(ptr(handle)) as Pointer;

  // スクロールバック上限は生成時オプションではなく生成後のsetで指定する
  // （ghostty_terminal_newは構造体値渡しをやめてcols/rowsのみ受け取る形になった）
  const scrollbackLimit = new BigUint64Array([BigInt(maxScrollback)]);
  vt.symbols.ghostty_terminal_set(term, OPT_SCROLLBACK_MAX_LINES, ptr(scrollbackLimit));

  let writePtyCallback: JSCallback | null = null;
  let clipboardCallback: JSCallback | null = null;
  let pwdChangedCallback: JSCallback | null = null;
  const writtenBuf = new BigUint64Array(1);
  const u16Out = new Uint16Array(1);
  const u8Out = new Uint8Array(1);

  /** DSR等のクエリ応答をPTYへ書き戻すコールバックを登録する */
  function onWritePty(fn: (data: Uint8Array) => void): void {
    writePtyCallback = new JSCallback(
      (_term: Pointer, _userdata: Pointer, data: Pointer, len: number | bigint) => {
        const n = Number(len);
        if (n > 0) fn(new Uint8Array(toArrayBuffer(data, 0, n)).slice());
      },
      {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64],
        returns: FFIType.void,
      },
    );
    vt.symbols.ghostty_terminal_set(term, OPT_WRITE_PTY, writePtyCallback.ptr);
  }

  /**
   * OSC 52等によるクリップボード書き込みを受けるコールバックを登録する。
   * fnにはtext/plain表現のバイト列を渡す（text/plainがなければ先頭の表現）。
   */
  function onClipboardWrite(fn: (data: Uint8Array) => void): void {
    // GhosttyClipboardWrite { size_t size; i32 location; GhosttyClipboardContent* contents; size_t contents_len }
    // GhosttyClipboardContent { GhosttyString mime; GhosttyString data } / GhosttyString { ptr; size_t len } = 32バイト
    clipboardCallback = new JSCallback(
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
    vt.symbols.ghostty_terminal_set(term, OPT_CLIPBOARD_WRITE, clipboardCallback.ptr);
  }

  const pwdBuf = new Uint8Array(16); // GhosttyString { const uint8_t* ptr; size_t len; }

  /**
   * カレントディレクトリの変化を受けるコールバックを登録する（OSC 7 / OSC 9 / OSC 1337）。
   * libghostty-vt（vt-only版）はURIパースを行わず、シェルが送った生のペイロードをそのまま返す
   * （OSC 7なら`file://host/path`等のURI丸ごと、OSC 9/1337なら生パス）。
   * デコードは呼び出し側（terminal-session.ts）の責務。
   * シェル側が空文字列を送った場合（pwd不明の通知）はfnを呼ばない。
   */
  function onPwdChanged(fn: (cwd: string) => void): void {
    pwdChangedCallback = new JSCallback(
      (_term: Pointer, _userdata: Pointer) => {
        const rc = vt.symbols.ghostty_terminal_get(term, DATA_PWD, ptr(pwdBuf));
        if (rc !== 0) return;
        const strPtr = read.ptr(ptr(pwdBuf), 0) as Pointer;
        const len = Number(read.u64(ptr(pwdBuf), 8));
        if (!strPtr || len === 0) return;
        fn(new TextDecoder().decode(new Uint8Array(toArrayBuffer(strPtr, 0, len))));
      },
      {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      },
    );
    vt.symbols.ghostty_terminal_set(term, OPT_PWD_CHANGED, pwdChangedCallback.ptr);
  }

  // GhosttyTerminalModeConfig { GhosttyMode mode(uint16); bool value; } のレイアウト（4バイト）。
  // modeを埋めてghostty_terminal_get(DATA_MODE)を呼ぶと、valueに現在値が返る
  const modeConfig = new Uint8Array(4);
  const modeConfigView = new DataView(modeConfig.buffer);

  /** bracketed pasteモード（DEC 2004）が有効か */
  function bracketedPaste(): boolean {
    modeConfigView.setUint16(0, MODE_BRACKETED_PASTE, true);
    const rc = vt.symbols.ghostty_terminal_get(term, DATA_MODE, ptr(modeConfig));
    return rc === 0 && modeConfig[2] !== 0;
  }

  /** ペースト文字列をPTY書き込み用に整形する（危険バイト除去 + bracketed paste包み） */
  function encodePaste(text: string): Uint8Array {
    if (text.length === 0) return new Uint8Array(0);
    const bracketed = bracketedPaste();
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
        ptr(writtenBuf),
      );
      const written = Number(writtenBuf[0]);
      if (rc === 0) return buf.subarray(0, written);
      if (written > buf.length) {
        buf = new Uint8Array(written);
        continue;
      }
      throw new Error(`ghostty_paste_encode failed: ${rc}`);
    }
  }

  function write(data: Uint8Array): void {
    if (data.length === 0) return;
    vt.symbols.ghostty_terminal_vt_write(term, ptr(data), BigInt(data.length));
  }

  function resize(cols: number, rows: number, cellWidthPx: number, cellHeightPx: number): void {
    vt.symbols.ghostty_terminal_resize(
      term,
      cols,
      rows,
      Math.round(cellWidthPx),
      Math.round(cellHeightPx),
    );
  }

  function cursor(): CursorState {
    vt.symbols.ghostty_terminal_get(term, DATA_CURSOR_X, ptr(u16Out));
    const x = u16Out[0] ?? 0;
    vt.symbols.ghostty_terminal_get(term, DATA_CURSOR_Y, ptr(u16Out));
    const y = u16Out[0] ?? 0;
    vt.symbols.ghostty_terminal_get(term, DATA_CURSOR_VISIBLE, ptr(u8Out));
    return { x, y, visible: u8Out[0] !== 0 };
  }

  /**
   * 画面内容を文字列として取り出す関数を作る（HTML/PLAINで共用）。
   * useViewport=trueならスクロールした位置（ghostty_terminal_scroll_viewport）に追従し、
   * falseなら常に最新のアクティブエリア（スクロールバック無視）を返す
   */
  function createFormatterDumper(emit: number, useViewport: boolean): () => string {
    let buf = new Uint8Array(256 * 1024);
    return function dump(): string {
      for (;;) {
        const rc = shim.symbols.niwa_dump_screen(
          term,
          emit,
          useViewport ? 1 : 0,
          ptr(buf),
          BigInt(buf.length),
          ptr(writtenBuf),
        );
        const written = Number(writtenBuf[0]);
        if (rc === 0) {
          return new TextDecoder().decode(buf.subarray(0, written));
        }
        if (written > buf.length) {
          buf = new Uint8Array(written + 1024);
          continue;
        }
        throw new Error(`niwa_dump_screen failed: ${rc}`);
      }
    };
  }

  /** 現在の画面をHTML文字列として取り出す。スクロール中はその位置の内容を返す */
  const dumpHtml = createFormatterDumper(FORMAT_HTML, true);

  /** 現在の画面をプレーンテキストとして取り出す（CLIの`tab capture`相当）。常に最新のアクティブエリア */
  const dumpText = createFormatterDumper(FORMAT_PLAIN, false);

  /** ビューポートがアクティブエリア（最新行）に追従しているか。falseはスクロールバックへ入っている状態 */
  function viewportPinned(): boolean {
    const rc = vt.symbols.ghostty_terminal_get(term, DATA_VIEWPORT_ACTIVE, ptr(u8Out));
    return rc !== 0 || u8Out[0] !== 0;
  }

  /** ビューポートを相対行数だけスクロールする（上がマイナス）。範囲外は自動でクランプされる */
  function scrollDelta(lines: number): void {
    if (lines === 0) return;
    shim.symbols.niwa_scroll_viewport(term, SCROLL_VIEWPORT_DELTA, BigInt(Math.trunc(lines)));
  }

  /** ビューポートをスクロールバックの先頭へ移動する */
  function scrollToTop(): void {
    shim.symbols.niwa_scroll_viewport(term, SCROLL_VIEWPORT_TOP, 0n);
  }

  /** ビューポートを最新のアクティブエリアへ戻す */
  function scrollToBottom(): void {
    shim.symbols.niwa_scroll_viewport(term, SCROLL_VIEWPORT_BOTTOM, 0n);
  }

  function free(): void {
    vt.symbols.ghostty_terminal_free(term);
    writePtyCallback?.close();
    clipboardCallback?.close();
    pwdChangedCallback?.close();
  }

  return {
    onWritePty,
    onClipboardWrite,
    onPwdChanged,
    bracketedPaste,
    encodePaste,
    write,
    resize,
    cursor,
    dumpHtml,
    dumpText,
    viewportPinned,
    scrollDelta,
    scrollToTop,
    scrollToBottom,
    free,
  };
}

export type GhosttyTerminal = ReturnType<typeof createGhosttyTerminal>;
