// PTY(forkpty) + libghostty-vt(VTパーサ) を束ねた「1ターミナルセッション」。
// index.tsはPTY/FFIの詳細を知らずにこのモジュールだけを使う。
// 将来のタブ実装は createTerminalSession() 1呼び出し = タブ1つに対応させる想定。
import { writeClipboardText } from "./clipboard";
import { type CursorShape, createGhosttyTerminal, type MouseEventInput } from "./ghostty";
import { createPty, type PtyOptions } from "./pty";
import { decodePwdReport } from "./pwd-report";

export type TerminalSessionCallbacks = {
  /** PTY出力によりVT状態が変わった時に呼ばれる。描画スケジューリングは呼び出し側の責務 */
  onOutput?: () => void;
  onExit?: (code: number) => void;
  /** シェル統合が送るOSC 7/9/1337でカレントディレクトリが変化した時に呼ばれる */
  onPwdChanged?: (cwd: string) => void;
};

export type TerminalSessionOptions = PtyOptions &
  TerminalSessionCallbacks & { maxScrollback?: number };

export interface TerminalRenderState {
  kind: "terminal";
  html: string;
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
  cursorShape: CursorShape;
  /** ビューポートが最新行に追従しているか。falseはスクロールバックを閲覧中 */
  viewportPinned: boolean;
  /** アプリがマウスレポートを有効にしているか（trueならwebview側はマウス操作を転送する） */
  mouseTracking: boolean;
  /** ボタン非押下時の移動も報告が要るモード（DECSET 1003）か */
  mouseAnyMotion: boolean;
}

export function createTerminalSession(opts: TerminalSessionOptions) {
  const pty = createPty({
    shell: opts.shell,
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    term: opts.term,
    env: opts.env,
    command: opts.command,
    captureStdoutTo: opts.captureStdoutTo,
  });
  const term = createGhosttyTerminal(opts.cols, opts.rows, opts.maxScrollback);

  let currentCols = opts.cols;
  let currentRows = opts.rows;
  let disposed = false;
  // popupからタブへの昇格（ADR 0006）時に呼び出し側がsetCallbacksで差し替えるため、
  // optsを直接参照せずmutableな変数へ切り出す
  let callbacks: TerminalSessionCallbacks = {
    onOutput: opts.onOutput,
    onExit: opts.onExit,
    onPwdChanged: opts.onPwdChanged,
  };

  // DSR等のクエリ応答（ESC[6n など）をPTYへ書き戻す
  term.onWritePty((data) => {
    pty.write(data);
  });

  // OSC 52によるクリップボード書き込みをシステムクリップボードへ流す
  term.onClipboardWrite((data) => {
    writeClipboardText(new TextDecoder().decode(data));
  });

  // OSC 7/9/1337によるカレントディレクトリの変化を呼び出し側へ伝える。
  // libghostty-vtは生ペイロードのまま渡すため、ここでURIデコードを行う（ホスト検証はしない、pwd-report.ts参照）
  term.onPwdChanged((raw) => {
    const cwd = decodePwdReport(raw);
    if (cwd !== null) callbacks.onPwdChanged?.(cwd);
  });

  // Windows実機ではPTYプロセスのonExit発火後にもdataコールバックが非同期に遅延発火することがあり、
  // dispose()でGhosttyTerminalを解放した後にterm.write()するとuse-after-freeでクラッシュする
  // （詳細: docs/known-issues/windows-pty-dispose-use-after-free.md）
  pty.onData((data) => {
    if (disposed) return;
    term.write(data);
    callbacks.onOutput?.();
  });

  // dispose()経由のpty.kill()もこのコールバックを発火させるため、明示的にdisposeした場合は
  // 「プロセスが予期せず終了した」通知を出さないようガードする（respawnTabがdispose→spawnし直す際、
  // ガード無しだとhandleTabProcessExitがtreeからタブを削除してしまい、最後の1タブなら
  // アプリごと終了する重大バグになる。実機検証で発覚）
  pty.onExit((code) => {
    if (disposed) return;
    callbacks.onExit?.(code);
  });

  /** popupからタブへの昇格時、PTYセッションを作り直さずに呼び出し先だけをBoard側へ差し替える */
  function setCallbacks(next: TerminalSessionCallbacks): void {
    callbacks = next;
  }

  // 他の主要ターミナル（xterm系/iTerm2/Ghostty等）と同様、スクロールバック閲覧中に
  // 何か入力すると自動で最新行へ戻る（tmuxのcopy-mode離脱に相当する挙動）
  function write(data: string | Uint8Array): void {
    term.scrollToBottom();
    pty.write(data);
  }

  function paste(text: string): void {
    term.scrollToBottom();
    pty.write(term.encodePaste(text));
  }

  /**
   * マウス操作をアプリへ転送する（マウスレポート有効時のみ意味を持つ）。
   * キー入力（write）と違いスクロールバック閲覧位置は動かさない。マウスレポート中の
   * アプリは代替画面にいることがほとんどで、勝手に最新行へ飛ばす必然性がないため
   */
  function mouseEvent(ev: MouseEventInput): void {
    const bytes = term.encodeMouse(ev);
    if (bytes.length > 0) pty.write(bytes);
  }

  function scroll(deltaLines: number): void {
    term.scrollDelta(deltaLines);
  }

  function scrollToTop(): void {
    term.scrollToTop();
  }

  function scrollToBottom(): void {
    term.scrollToBottom();
  }

  /**
   * セルの実寸（webview側の実測値）を伝える。マウスレポートのピクセル→グリッド変換に使う。
   * PTY・VTのグリッドサイズには影響しないため、resizeと違い毎回そのまま反映してよい
   */
  function setCellSize(cellWidthPx: number, cellHeightPx: number): void {
    term.setCellSize(cellWidthPx, cellHeightPx);
  }

  /** サイズが実際に変わった場合のみ term/pty 双方へ伝え、trueを返す（無駄な再描画を避ける） */
  function resize(cols: number, rows: number, cellWidthPx: number, cellHeightPx: number): boolean {
    if (cols <= 0 || rows <= 0) return false;
    // グリッドが同じでもセルの実寸は伝える（フォントサイズ変更等でセルだけ変わる場合がある）
    setCellSize(cellWidthPx, cellHeightPx);
    if (cols === currentCols && rows === currentRows) return false;
    currentCols = cols;
    currentRows = rows;
    term.resize(cols, rows, cellWidthPx, cellHeightPx);
    pty.resize(cols, rows);
    return true;
  }

  function renderState(): TerminalRenderState {
    const cursor = term.cursor();
    return {
      kind: "terminal",
      html: term.dumpHtml(),
      cursorX: cursor.x,
      cursorY: cursor.y,
      cursorVisible: cursor.visible,
      cursorShape: cursor.shape,
      viewportPinned: term.viewportPinned(),
      mouseTracking: term.mouseTracking(),
      mouseAnyMotion: term.mouseAnyMotion(),
    };
  }

  /** 現在の画面内容をプレーンテキストとして取り出す（CLIの`tab capture`相当） */
  function dumpText(): string {
    return term.dumpText();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    try {
      pty.kill();
    } catch {}
    term.free();
  }

  return {
    write,
    paste,
    mouseEvent,
    resize,
    setCellSize,
    scroll,
    scrollToTop,
    scrollToBottom,
    renderState,
    dumpText,
    setCallbacks,
    dispose,
  };
}

export type TerminalSession = ReturnType<typeof createTerminalSession>;
