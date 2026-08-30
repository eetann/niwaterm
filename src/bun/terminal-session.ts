// PTY(forkpty) + libghostty-vt(VTパーサ) を束ねた「1ターミナルセッション」。
// index.tsはPTY/FFIの詳細を知らずにこのモジュールだけを使う。
// 将来のタブ実装は createTerminalSession() 1呼び出し = タブ1つに対応させる想定。
import { writeClipboardText } from "./clipboard";
import {
  applyCopyModeKey,
  clampCopyModeCursor,
  copyModeRange,
  copyModeSelectionRows,
  createCopyModeState,
  type CopyModeContext,
  type CopyModeKey,
  type CopyModeSelectionMode,
  type CopyModeState,
  viewportOffsetForCursor,
} from "./copy-mode";
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

/** コピーモードの描画に必要な情報。座標はすべてビューポート座標（webviewがそのまま桁×セル幅で置ける） */
export interface CopyModeRenderState {
  /** コピーモードのカーソル位置。スクロールでビューポート外へ出ている場合はnull */
  cursor: { x: number; y: number } | null;
  selectionMode: CopyModeSelectionMode;
  /** 選択範囲を行ごとの桁区間へ落としたもの（両端とも含む） */
  selectionRows: Array<{ y: number; startX: number; endX: number }>;
}

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
  /** vi風コピーモード中の状態。コピーモードでなければnull */
  copyMode: CopyModeRenderState | null;
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

  // vi風コピーモードの状態（実際の操作はこのファイル下部の「vi風コピーモード」節）。
  // PTY出力のコールバックより前に初期化しておく必要があるためここで宣言する
  let copyMode: CopyModeState | null = null;
  /**
   * コピーモード中に維持するビューポート先頭の画面座標行。カーソル移動で意図的に
   * スクロールしたときだけ更新し、出力による追従はこの値へ引き戻す
   */
  let copyModeOffset = 0;
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
    // コピーモード中はビューポートを固定する（新しい出力が来ても閲覧位置が流れないように）。
    // ビューポートが最新行に張り付いている状態では出力のたびに勝手に追従するため、
    // 書き込み直後に固定位置へ戻し続ける必要がある（tmuxのcopy-modeと同じ体験）
    if (copyMode) term.scrollToRow(copyModeOffset);
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
  // 何か入力すると自動で最新行へ戻る（tmuxのcopy-mode離脱に相当する挙動）。
  // コピーモード中もCLIのsend-keys等でここへ来ることがあるため、その場合は先に抜ける
  function write(data: string | Uint8Array): void {
    exitCopyMode();
    term.scrollToBottom();
    pty.write(data);
  }

  function paste(text: string): void {
    exitCopyMode();
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

  // ---- vi風コピーモード（TASK-0012） ----
  // 状態と移動ロジックはcopy-mode.tsの純粋関数が持ち、ここは
  // 「行テキストのスナップショットを用意する」「ビューポートを追従させる」
  // 「選択範囲をlibghostty-vtに渡してテキスト化する」という副作用側だけを担う

  /**
   * copy-mode.tsに渡す画面のスナップショットを作る。行テキストはビューポートの上下1行分を
   * 余分に含める（j/kで端を越えた直後や、行を跨ぐ単語移動でその行のテキストが要るため）
   */
  function copyModeContext(): CopyModeContext {
    const bar = term.scrollbar();
    const viewportRows = Math.max(bar.len, 1);
    const totalRows = Math.max(bar.total, viewportRows);
    const firstLineRow = Math.max(bar.offset - 1, 0);
    const lastLineRow = Math.min(bar.offset + viewportRows, totalRows - 1);
    const expected = lastLineRow - firstLineRow + 1;
    const dumped = term.dumpScreenRange({
      startX: 0,
      startY: firstLineRow,
      endX: Math.max(currentCols - 1, 0),
      endY: lastLineRow,
    });
    // フォーマッタは末尾に改行を付けないが、行数が足りない場合に備えて空行で埋める
    // （行が取れないと桁のクランプが効かず、カーソルが行の外へ残ってしまう）
    const lines = dumped === "" ? [] : dumped.split("\n");
    while (lines.length < expected) lines.push("");
    return {
      cols: currentCols,
      viewportRows,
      viewportOffset: bar.offset,
      totalRows,
      firstLineRow,
      lines: lines.slice(0, expected),
    };
  }

  /** カーソルがビューポートから出ていたらスクロールし、新しい行テキストで桁を揃え直す */
  function syncCopyModeViewport(state: CopyModeState): CopyModeState {
    const ctx = copyModeContext();
    const offset = viewportOffsetForCursor(state, ctx);
    if (offset === ctx.viewportOffset) {
      copyModeOffset = ctx.viewportOffset;
      return clampCopyModeCursor(state, ctx);
    }
    term.scrollToRow(offset);
    const next = copyModeContext();
    copyModeOffset = next.viewportOffset;
    return clampCopyModeCursor(state, next);
  }

  function isCopyMode(): boolean {
    return copyMode !== null;
  }

  /**
   * コピーモードへ入る。ターミナルのカーソル位置から開始し、その時点のビューポートを
   * 絶対行で固定する（固定しないと、閲覧中に新しい出力が来るたび画面が流れてしまう）
   */
  function enterCopyMode(): void {
    if (copyMode) return;
    const bar = term.scrollbar();
    const cursor = term.cursor();
    copyModeOffset = bar.offset;
    term.scrollToRow(copyModeOffset);
    copyMode = syncCopyModeViewport(createCopyModeState({ x: cursor.x, y: bar.offset + cursor.y }));
  }

  /** コピーモードを抜けて最新行へ戻る */
  function exitCopyMode(): void {
    if (!copyMode) return;
    copyMode = null;
    term.scrollToBottom();
  }

  /**
   * コピーモード中の1キーを処理する。コピーモードでない・未割当のキーならfalseを返す
   * （呼び出し側が通常の入力として扱えるようにするため）
   */
  function handleCopyModeKey(key: CopyModeKey): boolean {
    if (!copyMode) return false;
    const result = applyCopyModeKey(copyMode, key, copyModeContext());
    if (!result.handled) return false;
    switch (result.effect.type) {
      case "yank": {
        const { start, end, mode } = result.effect.range;
        // 折り返された長いコマンド行を1行として取り出したいのでunwrap、
        // グリッドの行末を埋める空白は要らないのでtrimを有効にする
        const text = term.dumpScreenRange({
          startX: start.x,
          startY: start.y,
          endX: mode === "line" ? Math.max(currentCols - 1, 0) : end.x,
          endY: end.y,
          unwrap: true,
          trim: true,
        });
        const trimmed = text.replace(/\n+$/u, "");
        if (trimmed !== "") writeClipboardText(trimmed);
        exitCopyMode();
        return true;
      }
      case "exit":
        exitCopyMode();
        return true;
      default:
        copyMode = syncCopyModeViewport(result.state);
        return true;
    }
  }

  function copyModeRenderState(): CopyModeRenderState | null {
    if (!copyMode) return null;
    const ctx = copyModeContext();
    const viewportY = copyMode.cursor.y - ctx.viewportOffset;
    const range = copyModeRange(copyMode, ctx.cols);
    return {
      cursor:
        viewportY >= 0 && viewportY < ctx.viewportRows
          ? { x: copyMode.cursor.x, y: viewportY }
          : null,
      selectionMode: copyMode.selectionMode,
      selectionRows: range ? copyModeSelectionRows(range, ctx) : [],
    };
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
      copyMode: copyModeRenderState(),
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
    isCopyMode,
    enterCopyMode,
    exitCopyMode,
    handleCopyModeKey,
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
