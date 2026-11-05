// PTY(forkpty) + libghostty-vt(VTパーサ) を束ねた「1ターミナルセッション」。
// index.tsはPTY/FFIの詳細を知らずにこのモジュールだけを使う。
// 将来のタブ実装は createTerminalSession() 1呼び出し = タブ1つに対応させる想定。
import { writeClipboardText, writeClipboardTextFromApp } from "./clipboard";
import {
  applyCopyModeKey,
  clampCopyModeCursor,
  copyModeRange,
  copyModeSelectionRows,
  copyModeMatchRows,
  createCopyModeState,
  firstNonBlankColumn,
  isCaseSensitiveQuery,
  pickCopyModeMatch,
  type CopyModeContext,
  type CopyModeKeyPress,
  type CopyModeMatch,
  type CopyModeSearch,
  type CopyModeSelectionMode,
  type CopyModeState,
  viewportOffsetForCursor,
} from "./copy-mode";
import {
  createGhosttyTerminal,
  type CursorShape,
  type KittyImage,
  type KittyPlacement,
  type MouseEventInput,
  type PromptLocation,
} from "./ghostty";
import { createPty, type PtyOptions } from "./pty";
import { decodePwdReport } from "./pwd-report";

export type TerminalSessionCallbacks = {
  /** PTY出力によりVT状態が変わった時に呼ばれる。描画スケジューリングは呼び出し側の責務 */
  onOutput?: () => void;
  /** codeはシグナル等で終了コードを持たずに終わった場合null */
  onExit?: (code: number | null) => void;
  /** シェル統合が送るOSC 7/9/1337でカレントディレクトリが変化した時に呼ばれる */
  onPwdChanged?: (cwd: string) => void;
  /** BEL文字(0x07)を受け取った時に呼ばれる */
  onBell?: () => void;
  /**
   * シェル統合が報告した実行中のコマンド行が変わった時に呼ばれる。nullは実行中のコマンドが無い
   * （プロンプトへ戻った）状態。シェル統合のOSC 133から拾う
   */
  onRunningCommandChanged?: (command: string | null) => void;
};

export type TerminalSessionOptions = PtyOptions &
  TerminalSessionCallbacks & {
    /** スクロールバックとして保持する行数の上限。省略時はghostty.ts側のフォールバック値 */
    maxScrollback?: number;
  };

/** コピーモードの描画に必要な情報。座標はすべてビューポート座標（webviewがそのまま桁×セル幅で置ける） */
export interface CopyModeRenderState {
  /** コピーモードのカーソル位置。スクロールでビューポート外へ出ている場合はnull */
  cursor: { x: number; y: number } | null;
  selectionMode: CopyModeSelectionMode;
  /** 選択範囲を行ごとの桁区間へ落としたもの（両端とも含む） */
  selectionRows: Array<{ y: number; startX: number; endX: number }>;
  /** 検索文字列に一致した箇所（ビューポート内のみ。入力中は打ちかけの文字列で先行表示する） */
  searchRows: Array<{ y: number; startX: number; endX: number }>;
  /** 検索文字列の入力中に表示するプロンプト（"/foo" / "?foo"）。入力中でなければnull */
  searchPrompt: string | null;
  /** 「パターンが見つかりません」等の一時メッセージ。無ければnull */
  message: string | null;
}

export interface TerminalRenderState {
  kind: "terminal";
  html: string;
  /**
   * インデックス指定色（SGRの30-37・38;5;N等）用のパレットCSS。中身は
   * `:root{--vt-palette-0: #...;...}` の256色分で、htmlはこれをvar()で参照する。
   * 内容が前回と変わったときだけ入り、変化なしならnull（index.tsが差分を判定する）
   */
  paletteCss: string | null;
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
  /** Kitty graphics protocolで表示した画像の配置（ビューポートに掛かっているもののみ） */
  kittyPlacements: KittyPlacement[];
  /**
   * kittyPlacementsが参照する画像。rgbaBase64がnullのものは同じウィンドウへ送信済みのため
   * 中身を省いたもの（index.tsのdropSentKittyImages）で、webviewは手元のキャッシュを使う
   */
  kittyImages: Array<Omit<KittyImage, "rgbaBase64"> & { rgbaBase64: string | null }>;
}

/**
 * runCommandWhenReadyで積んだコマンドを流すまでの、PTY出力が途切れてからの静穏時間。
 * シェルの初期化出力は数回に分かれて届くため、最初の1回ではなく「出力が落ち着いた」時点を待つ
 */
const INITIAL_COMMAND_QUIET_MS = 150;
/**
 * 出力が全く来ない・出力が続き続けるシェルでも必ず流すための上限。
 * WSLディストロの起動は数秒かかることがあるため、短くしすぎるとプロンプト表示前に流してしまう
 */
const INITIAL_COMMAND_TIMEOUT_MS = 5000;
/**
 * 静穏後もbracketed paste（DEC 2004）が無効なままのときに、有効化を待ち直す上限。
 * シェルはこれを行編集の開始時に有効化するため、有効＝コマンドを受け取れる状態という合図になる。
 * WSLディストロのコールドスタートのように起動途中の出力が途切れると静穏だけでは早すぎて、
 * プロンプトが出る前の取りこぼしと、ペーストではなく1文字ずつの入力になることの両方を招く。
 * bracketed pasteを使わないシェル（PowerShell等）ではこの時間を待ち切ってから素の入力として送る
 */
const BRACKETED_PASTE_WAIT_MS = 1000;
/** bracketed pasteが有効になったかを見直す間隔 */
const BRACKETED_PASTE_RECHECK_MS = 50;

const PALETTE_STYLE_OPEN = "<style>";
const PALETTE_STYLE_CLOSE = "</style>";

/**
 * HTMLダンプの先頭に付くパレット定義（`<style>:root{--vt-palette-0: ...}</style>`）を本文から切り離す。
 * 中身は256色分で6KB強あるうえ内容は普段変わらないため、毎フレーム丸ごと運ばずに済ませる。
 * フォーマッタの出力形が変わって切り出せなかった場合は、丸ごと本文として扱い従来どおりに描かせる
 */
export function splitPaletteCss(html: string): { paletteCss: string | null; body: string } {
  if (!html.startsWith(PALETTE_STYLE_OPEN)) return { paletteCss: null, body: html };
  const close = html.indexOf(PALETTE_STYLE_CLOSE);
  if (close < 0) return { paletteCss: null, body: html };
  return {
    paletteCss: html.slice(PALETTE_STYLE_OPEN.length, close),
    body: html.slice(close + PALETTE_STYLE_CLOSE.length),
  };
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
  /** 検索結果などをコピーモード中に一時表示するメッセージ。次のキー入力で消える */
  let copyModeMessage: string | null = null;
  let currentCols = opts.cols;
  let currentRows = opts.rows;
  let disposed = false;
  let exited = false;
  // runCommandWhenReadyで積んだ、シェルの起動待ち中のコマンド（layoutsプリセットのcommand等）
  let pendingInitialCommands: string[] = [];
  /** 初期コマンドを一度流した後か。以降のrunCommandWhenReadyは待たずに即実行する */
  let initialCommandFlushed = false;
  let initialCommandQuietTimer: ReturnType<typeof setTimeout> | null = null;
  /** 静穏が最初に成立した時刻。bracketed pasteの有効化を待ち直す上限の起点 */
  let bracketedWaitSince: number | null = null;
  let initialCommandDeadline: ReturnType<typeof setTimeout> | null = null;
  // popupからタブへの昇格（ADR 0006）時に呼び出し側がsetCallbacksで差し替えるため、
  // optsを直接参照せずmutableな変数へ切り出す
  let callbacks: TerminalSessionCallbacks = {
    onOutput: opts.onOutput,
    onExit: opts.onExit,
    onPwdChanged: opts.onPwdChanged,
    onBell: opts.onBell,
    onRunningCommandChanged: opts.onRunningCommandChanged,
  };
  let runningCommand: string | null = null;

  // DSR等のクエリ応答（ESC[6n など）をPTYへ書き戻す
  term.onWritePty((data) => {
    pty.write(data);
  });

  // OSC 52によるクリップボード書き込みをシステムクリップボードへ流す
  term.onClipboardWrite((data) => {
    writeClipboardTextFromApp(new TextDecoder().decode(data));
  });

  // OSC 7/9/1337によるカレントディレクトリの変化を呼び出し側へ伝える。
  // libghostty-vtは生ペイロードのまま渡すため、ここでURIデコードを行う（ホスト検証はしない、pwd-report.ts参照）
  term.onPwdChanged((raw) => {
    const cwd = decodePwdReport(raw);
    if (cwd !== null) callbacks.onPwdChanged?.(cwd);
  });

  term.onBell(() => {
    callbacks.onBell?.();
  });

  // シェル統合はコマンド実行の開始（OSC 133のC）にkittyの拡張`cmdline_url`でコマンド行を付けて送り、
  // 次のプロンプトの開始（A）・コマンドの終了（D）で実行中でなくなる。
  // PTY出力と同じストリームに乗るので、CLIを経由する通知と違って開始と終了が入れ替わって届くことが無い
  term.onSemanticPrompt((event) => {
    let next: string | null;
    if (event.kind === "promptStart" || event.kind === "commandEnd") {
      next = null;
    } else if (event.kind === "outputStart" && event.command !== "") {
      next = event.command;
    } else {
      // コマンド行の付かないC（他のシェル統合が出すもの）は何も変えない。素のCで記録を消すと、
      // 自前のCの直後に別のツールがCを出す環境で、記録したコマンド行がすぐ失われる
      return;
    }
    if (next === runningCommand) return;
    runningCommand = next;
    callbacks.onRunningCommandChanged?.(next);
  });

  // Windows実機ではPTYプロセスのonExit発火後にもdataコールバックが非同期に遅延発火することがあり、
  // dispose()でGhosttyTerminalを解放した後にterm.write()するとuse-after-freeでクラッシュする
  // （詳細: docs/known-issues/windows-pty-dispose-use-after-free.md）
  pty.onData((data) => {
    if (disposed) return;
    term.write(data);
    // シェルがまだ出力中＝初期化の途中とみなし、積んである初期コマンドの送出を先送りする
    if (pendingInitialCommands.length > 0) scheduleInitialCommandFlush();
    // コピーモード中はビューポートを固定する（新しい出力が来ても閲覧位置が流れないように）。
    // ビューポートが最新行に張り付いている状態では出力のたびに勝手に追従するため、
    // 書き込み直後に固定位置へ戻し続ける必要がある（tmuxのcopy-modeと同じ体験）
    if (copyMode) term.scrollToRow(copyModeOffset);
    callbacks.onOutput?.();
  });

  // dispose()経由のpty.kill()もこのコールバックを発火させるため、明示的にdisposeした場合は
  // 「プロセスが予期せず終了した」通知を出さないようガードする（respawnTabがdispose→spawnし直す際、
  // ガード無しだとhandleTabProcessExitがtreeからタブを削除してしまい、最後の1タブなら
  // アプリごと終了してしまう）
  pty.onExit((code) => {
    exited = true;
    if (disposed) return;
    callbacks.onExit?.(code);
  });

  /** PTYを経由せず画面へ直接文字列を書く。プロセスが終了したタブへの案内表示に使う */
  function showNotice(text: string): void {
    if (disposed) return;
    term.write(new TextEncoder().encode(text));
    callbacks.onOutput?.();
  }

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

  /**
   * タブ作成直後のシェルへコマンドを流し込んで実行する（layoutsプリセットのcommand）。
   *
   * PTY起動直後は、シェル（と.zshrc等の初期化）がまだ端末を読み始めておらず、この時点で
   * 書き込んだ入力は取りこぼされる。zshの場合、起動途中に流し込んだ入力は先頭側が欠け、
   * 残りだけがコマンドラインへ入る（layoutsプリセットのcommandが途中から実行される症状で確認）。
   * niwaterm側にシェルの準備完了を知る手段は無いため、「最初の出力が来て、そこから
   * INITIAL_COMMAND_QUIET_MSのあいだ出力が止まった」＝プロンプトを出し終えた合図とみなして流す
   * （出力が途切れただけの状態と区別するためbracketed pasteの有効化も併せて待つ。
   * onInitialCommandQuiet参照）。一度流した後は待たずに即実行する
   */
  function runCommandWhenReady(command: string): void {
    if (initialCommandFlushed) {
      runCommand(command);
      return;
    }
    pendingInitialCommands.push(command);
    // 静穏タイマーはここでは張らない。PTYからの最初の出力（pty.onData）が来て初めて
    // 起動が進み始めたと分かるため、それまではタイムアウトの保険だけで待つ
    if (initialCommandDeadline === null) {
      initialCommandDeadline = setTimeout(flushInitialCommands, INITIAL_COMMAND_TIMEOUT_MS);
    }
  }

  /**
   * コマンドを1行ずつ「ペースト＋Enter」として送る。キー入力として1文字ずつ送ると、
   * zshのZLEのような行編集機能は文字ごとにwidget（シンタックスハイライト・補完の先読み・
   * スニペット展開）を走らせるため、コマンドが長いほど流し込みの完了が遅れる。
   * ペーストなら行全体が1回の挿入として扱われ、フックも1回で済む。
   * bracketed paste（DEC 2004）を有効にしていないシェルへはencodePasteが素の文字列を返すため、
   * その場合は従来どおりの逐次入力になる
   */
  function runCommand(command: string): void {
    for (const line of command.split("\n")) {
      paste(line);
      pty.write("\r");
    }
  }

  function scheduleInitialCommandFlush(): void {
    if (initialCommandQuietTimer !== null) clearTimeout(initialCommandQuietTimer);
    // 出力が再開した＝まだ初期化の途中なので、bracketed pasteの待ち時間も計り直す
    bracketedWaitSince = null;
    initialCommandQuietTimer = setTimeout(onInitialCommandQuiet, INITIAL_COMMAND_QUIET_MS);
  }

  /** 出力が止まった。シェルが入力を受け取れる状態か確かめてから流す */
  function onInitialCommandQuiet(): void {
    if (!term.bracketedPaste()) {
      if (bracketedWaitSince === null) bracketedWaitSince = Date.now();
      if (Date.now() - bracketedWaitSince < BRACKETED_PASTE_WAIT_MS) {
        initialCommandQuietTimer = setTimeout(onInitialCommandQuiet, BRACKETED_PASTE_RECHECK_MS);
        return;
      }
    }
    flushInitialCommands();
  }

  function flushInitialCommands(): void {
    clearInitialCommandTimers();
    initialCommandFlushed = true;
    const commands = pendingInitialCommands;
    pendingInitialCommands = [];
    if (disposed) return;
    for (const command of commands) runCommand(command);
  }

  function clearInitialCommandTimers(): void {
    if (initialCommandQuietTimer !== null) clearTimeout(initialCommandQuietTimer);
    if (initialCommandDeadline !== null) clearTimeout(initialCommandDeadline);
    initialCommandQuietTimer = null;
    initialCommandDeadline = null;
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

  // ---- vi風コピーモード ----
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

  /**
   * smartcaseのクエリ（大文字を含む）向けに、一致の文字列が大文字小文字まで揃っているかを返す。
   * libghostty-vtの検索はASCIIの英字を常に区別しないため、区別したいときはここで絞り込む。
   * 区別しないクエリならundefinedを返す
   */
  function exactCaseFilter(query: string): ((match: CopyModeMatch) => boolean) | undefined {
    if (!isCaseSensitiveQuery(query)) return undefined;
    // 折り返し行をまたぐ一致も1つの文字列として比べたいのでunwrapする
    return (m) =>
      term.dumpScreenRange({
        startX: m.start.x,
        startY: m.start.y,
        endX: m.end.x,
        endY: m.end.y,
        unwrap: true,
      }) === query;
  }

  /**
   * スクロールバックを含む画面全体からカーソルの次の一致を探して移す（見つからなければnull）。
   * 端まで行ったら反対の端から折り返して探す（vimのwrapscan相当）
   */
  function searchCopyMode(state: CopyModeState, search: CopyModeSearch): CopyModeState | null {
    const match = pickCopyModeMatch({
      matches: term.searchMatches(search.query, "all"),
      from: state.cursor,
      direction: search.direction,
      accept: exactCaseFilter(search.query),
    });
    if (!match) return null;
    return { ...state, cursor: { ...match.start }, desiredX: match.start.x };
  }

  /**
   * プロンプトへ飛べなかった理由の文言。画面のどこにもマークが無ければシェル統合の未導入で、
   * あるのに飛べないなら端に着いただけ。原因が全く違うので取り違えないよう分けて伝える
   */
  function promptJumpMissReason(): string {
    // findPromptは起点の行を含めないので、-1から下向きに探せば画面全体が対象になる
    if (term.findPrompt(-1, "down") === null) {
      return "プロンプトマークがありません（シェル統合の導入が必要）";
    }
    return "これ以上プロンプトがありません";
  }

  /**
   * カーソルを動かす先のプロンプトを探す。飛び先はブロックの先頭行ではなくコマンドを打った行
   * （inputRow）で、先頭行のほうはpowerlevel10kのように区切りの空行から始まるプロンプトだと
   * 前のコマンドの出力の末尾に見えてしまい、どのコマンドなのか分からないため。
   *
   * 起点がすでにそのブロックの中にあると同じコマンド行へ戻ってきてしまうので、
   * 進めなかった場合は1つ先のプロンプトから探し直す
   */
  function findPromptFrom(fromY: number, direction: "up" | "down"): PromptLocation | null {
    let from = fromY;
    // 同じブロックへの着地は1回で解消する。保険としてもう1回だけ回す
    for (let i = 0; i < 3; i++) {
      const found = term.findPrompt(from, direction);
      if (found === null) return null;
      if (direction === "up" ? found.inputRow < fromY : found.inputRow > fromY) return found;
      from = found.row;
    }
    return null;
  }

  /**
   * コピーモードに入らずにビューポートだけを前後のプロンプトへ動かす。見つかった行が
   * ビューポートの先頭に来るようスクロールする（そのコマンドの出力を上から読めるため）。
   * 飛べなければfalseを返す
   */
  function jumpPrompt(direction: "up" | "down"): boolean {
    const before = term.scrollbar().offset;
    const found = term.findPrompt(before, direction);
    if (found === null) return false;
    // ビューポートはブロックの先頭行（プロンプトの1行目）に合わせる。
    // コマンド行に合わせるとプロンプトの装飾が画面の上へ切れて文脈が分かりにくくなるため
    term.scrollToRow(found.row);
    // 最後の1画面ぶんに収まるプロンプトはどれを指してもビューポートが同じ位置で
    // クランプされる。動かなかったなら、その先はもう見せるものが無い
    return term.scrollbar().offset !== before;
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
    copyModeMessage = null;
    // 検索文字列を残したままだと、libghostty-vtが一致の追跡を続けて出力のたびに手間が掛かる
    term.clearSearch();
    term.scrollToBottom();
  }

  /**
   * コピーモード中の1キーを処理する。コピーモードでない・未割当のキーならfalseを返す
   * （呼び出し側が通常の入力として扱えるようにするため）
   */
  function handleCopyModeKey(press: CopyModeKeyPress): boolean {
    if (!copyMode) return false;
    const result = applyCopyModeKey(copyMode, press.key, copyModeContext(), press.keymap);
    if (!result.handled) return false;
    // メッセージは次のキー入力まで（キーを1つ処理したら消す）
    copyModeMessage = null;
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
      case "search": {
        const { search } = result.effect;
        const found = searchCopyMode(result.state, search);
        if (!found) {
          copyModeMessage = `見つかりません: ${search.query}`;
        }
        copyMode = syncCopyModeViewport(found ?? result.state);
        return true;
      }
      case "jumpPrompt": {
        const { direction } = result.effect;
        const found = findPromptFrom(result.state.cursor.y, direction);
        if (found === null) {
          copyModeMessage = promptJumpMissReason();
          copyMode = syncCopyModeViewport(result.state);
          return true;
        }
        const x = firstNonBlankColumn(
          term.dumpScreenRange({
            startX: 0,
            startY: found.inputRow,
            endX: Math.max(currentCols - 1, 0),
            endY: found.inputRow,
          }),
        );
        copyMode = syncCopyModeViewport({
          ...result.state,
          cursor: { x, y: found.inputRow },
          desiredX: x,
        });
        return true;
      }
      case "exit":
        exitCopyMode();
        return true;
      case "custom":
        copyMode = syncCopyModeViewport(result.state);
        press.runHandler(result.effect.handlerId);
        return true;
      default:
        copyMode = syncCopyModeViewport(result.state);
        return true;
    }
  }

  /**
   * ビューポート内の検索一致をハイライト用に集める。入力中は打ちかけの文字列で先に光らせ、
   * 確定後は直前の検索文字列を光らせ続ける（vimのhlsearch相当）
   */
  function copyModeSearchRows(
    ctx: CopyModeContext,
  ): Array<{ y: number; startX: number; endX: number }> {
    const query = copyMode?.searchInput?.query ?? copyMode?.lastSearch?.query ?? "";
    if (query === "") return [];
    const lastRow = ctx.viewportOffset + ctx.viewportRows - 1;
    // ビューポート向けの一致には同じページに載った画面外の一致も混ざるため、先に見える範囲へ絞ってから
    // 大文字小文字を確かめる（確認は1件ごとに文字列を取り出すので、件数を減らしてから行う）
    const visible = term
      .searchMatches(query, "viewport")
      .filter((m) => m.end.y >= ctx.viewportOffset && m.start.y <= lastRow);
    const accept = exactCaseFilter(query);
    return copyModeMatchRows(accept ? visible.filter(accept) : visible, ctx);
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
      searchRows: copyModeSearchRows(ctx),
      searchPrompt: copyMode.searchInput
        ? `${copyMode.searchInput.direction === "forward" ? "/" : "?"}${copyMode.searchInput.query}`
        : null,
      message: copyModeMessage,
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
    // 終了したプロセスのPTYはリサイズしない。WindowsのConPTYはリサイズのたびに自分が覚えている
    // 画面を描き直して送ってくるため、showNoticeで画面へ直接書いた案内が上書きされて消える
    if (!exited) pty.resize(cols, rows);
    return true;
  }

  function renderState(): TerminalRenderState {
    const cursor = term.cursor();
    const { paletteCss, body } = splitPaletteCss(term.dumpHtml());
    const kitty = term.kittyGraphics();
    return {
      kind: "terminal",
      html: body,
      paletteCss,
      cursorX: cursor.x,
      cursorY: cursor.y,
      cursorVisible: cursor.visible,
      cursorShape: cursor.shape,
      viewportPinned: term.viewportPinned(),
      mouseTracking: term.mouseTracking(),
      mouseAnyMotion: term.mouseAnyMotion(),
      copyMode: copyModeRenderState(),
      kittyPlacements: kitty.placements,
      kittyImages: kitty.images,
    };
  }

  /** シェル統合が報告した、今実行中のコマンド行。無ければnull */
  function getRunningCommand(): string | null {
    return runningCommand;
  }

  /** 現在の画面内容をプレーンテキストとして取り出す（CLIの`tab capture`相当） */
  function dumpText(): string {
    return term.dumpText();
  }

  /**
   * スクロールバックの保持行数の上限を変更する（設定ファイルのホットリロード用）。
   * 下げた場合はその時点で上限を超える履歴が破棄される
   */
  function setMaxScrollback(lines: number): void {
    term.setScrollbackMaxLines(lines);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearInitialCommandTimers();
    pendingInitialCommands = [];
    try {
      pty.kill();
    } catch {}
    term.free();
  }

  return {
    write,
    runCommandWhenReady,
    paste,
    mouseEvent,
    isCopyMode,
    enterCopyMode,
    exitCopyMode,
    handleCopyModeKey,
    resize,
    setCellSize,
    setMaxScrollback,
    scroll,
    scrollToTop,
    scrollToBottom,
    jumpPrompt,
    renderState,
    dumpText,
    getRunningCommand,
    showNotice,
    setCallbacks,
    dispose,
  };
}

export type TerminalSession = ReturnType<typeof createTerminalSession>;
