// PTY(forkpty) + libghostty-vt(VTパーサ) を束ねた「1ターミナルセッション」。
// index.tsはPTY/FFIの詳細を知らずにこのモジュールだけを使う。
// 将来のタブ実装は createTerminalSession() 1呼び出し = タブ1つに対応させる想定。
import { createGhosttyTerminal } from "./ghostty";
import { createPty, type PtyOptions } from "./pty";

export type TerminalSessionOptions = PtyOptions & {
  maxScrollback?: number;
  /** PTY出力によりVT状態が変わった時に呼ばれる。描画スケジューリングは呼び出し側の責務 */
  onOutput?: () => void;
  onExit?: (code: number) => void;
};

export interface TerminalRenderState {
  html: string;
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
}

export function createTerminalSession(opts: TerminalSessionOptions) {
  const pty = createPty({
    shell: opts.shell,
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    term: opts.term,
  });
  const term = createGhosttyTerminal(opts.cols, opts.rows, opts.maxScrollback);

  let currentCols = opts.cols;
  let currentRows = opts.rows;
  let disposed = false;

  // DSR等のクエリ応答（ESC[6n など）をPTYへ書き戻す
  term.onWritePty((data) => {
    pty.write(data);
  });

  // OSC 52によるクリップボード書き込みをシステムクリップボードへ流す
  term.onClipboardWrite((data) => {
    writeClipboard(data);
  });

  pty.onData((data) => {
    term.write(data);
    opts.onOutput?.();
  });

  pty.onExit((code) => {
    opts.onExit?.(code);
  });

  function write(data: string | Uint8Array): void {
    pty.write(data);
  }

  function paste(text: string): void {
    pty.write(term.encodePaste(text));
  }

  /** サイズが実際に変わった場合のみ term/pty 双方へ伝え、trueを返す（無駄な再描画を避ける） */
  function resize(cols: number, rows: number, cellWidthPx: number, cellHeightPx: number): boolean {
    if (cols === currentCols && rows === currentRows) return false;
    if (cols <= 0 || rows <= 0) return false;
    currentCols = cols;
    currentRows = rows;
    term.resize(cols, rows, cellWidthPx, cellHeightPx);
    pty.resize(cols, rows);
    return true;
  }

  function renderState(): TerminalRenderState {
    const cursor = term.cursor();
    return {
      html: term.dumpHtml(),
      cursorX: cursor.x,
      cursorY: cursor.y,
      cursorVisible: cursor.visible,
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    try {
      pty.kill();
    } catch {}
    term.free();
  }

  return { write, paste, resize, renderState, dispose };
}

export type TerminalSession = ReturnType<typeof createTerminalSession>;

function writeClipboard(data: Uint8Array): void {
  const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
  proc.stdin.write(data);
  proc.stdin.end();
}
