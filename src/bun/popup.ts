// Tile木構造とは独立した、Workspace直下のポップアップ画面（ADR 0005・ADR 0006）。
// tmuxのpopup/floating相当。Boardをまたいでも同じポップアップを使えるよう、Board単位ではなく
// Workspace単位でTerminalSessionを1つだけ管理する。「タブへ昇格」時はPTYセッションを作り直さず、
// takeForPromotion()でsessionをそのまま呼び出し側（workspace.ts）へ渡し、board.tsのadoptTabへ編入させる。
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MouseEventInput } from "./ghostty";
import { ipcSocketPath, WSL_BRIDGE_PORT } from "./ipc-server";
import {
  createTerminalSession,
  type TerminalRenderState,
  type TerminalSession,
} from "./terminal-session";
import type { TabId } from "./tile-layout";

export interface PopupRenderState {
  tabId: TabId;
  visible: boolean;
  width?: number;
  height?: number;
}

export interface OpenPopupOptions {
  /** 省略時は呼び出し側が渡したフォーカス中タブのcwdを引き継ぐ（split-tile/newTabと同じ方針） */
  cwd?: string;
  /** 指定すると、このコマンドをシェルの代わりに実行する（ワンショット実行）。終了すると自動的にポップアップも閉じる */
  command?: string;
  /**
   * trueかつcommand指定時、コマンドの標準出力を一時ファイルへリダイレクトし、
   * 閉じた時点（waitForClose解決時）にその内容を返す（`popup open --wait --capture-stdout`用、
   * fzf-tmuxの結果受け渡し方式を参考）。commandが標準出力に出したものだけが対象で、
   * UI描画自体はPTY（画面）にそのまま残る
   */
  captureStdout?: boolean;
  /** 表示サイズ（1〜100のパーセント）。省略時はCSS側の既定値に従う */
  width?: number;
  height?: number;
}

/** openPopup呼び出し元（workspace.ts）が継承元として渡すサイズ・cwd */
export interface InheritedTabSnapshot {
  cols: number;
  rows: number;
  cwd?: string;
}

/** promotePopup成功時にboard.tsのadoptTabへそのまま渡せる形の戻り値 */
export interface PromotedPopup {
  tabId: TabId;
  session: TerminalSession;
  cols: number;
  rows: number;
  shell?: string;
  vars?: Record<string, string>;
}

export type PopupOptions = {
  genTabId: () => TabId;
  /** 新規タブ作成時に使うデフォルトシェルを取得する。省略時はpty.ts側のOS標準シェルを使う */
  getDefaultShell?: () => string | undefined;
  /** 描画すべき変化が生じた時に呼ばれる。描画スケジューリングは呼び出し側の責務 */
  onDirty: () => void;
  /** テスト時にfakeへ差し替えるためのDI */
  createSession?: typeof createTerminalSession;
};

export function createPopup(opts: PopupOptions) {
  const createSession = opts.createSession ?? createTerminalSession;
  let tabId: TabId | null = null;
  let session: TerminalSession | null = null;
  let visible = false;
  let width: number | undefined;
  let height: number | undefined;
  let cols = 0;
  let rows = 0;
  let shell: string | undefined;
  const vars = new Map<string, string>();
  // open()時点ではまだPTYを起動しない。webview側から実際のポップアップ枠サイズが届く
  // 最初のhandleResizeまで保留し、そこで確定サイズを渡して起動する（spawnSession参照）。
  // openPopupOpts/inheritedはその起動に必要な情報を一時的に保持するだけの箱
  let pendingOpts: OpenPopupOptions | null = null;
  let pendingInherited: InheritedTabSnapshot | null = null;
  // popup open --wait（CLI）がPTY終了まで待つための待機列。close/takeForPromotion
  // いずれの経路でポップアップが「開いていない」状態に戻っても解放する。
  // 解決値はcaptureStdout時のキャプチャ結果（無ければundefined）
  let closeWaiters: Array<(output: string | undefined) => void> = [];
  // captureStdout指定時、commandの標準出力のリダイレクト先（close時に読み込んで削除する）
  let captureFile: string | null = null;

  function reset(): void {
    tabId = null;
    session = null;
    visible = false;
    width = undefined;
    height = undefined;
    shell = undefined;
    vars.clear();
    pendingOpts = null;
    pendingInherited = null;
  }

  /**
   * 保留していたPTYを実際に起動する。webview側で実測したポップアップ枠のcols/rowsで
   * 一発目から起動することで、SIGWINCHへの追従に頼らない（TASK-0045）。
   * 起動直後にresizeでサイズを送り直す旧実装だと、fzf等「起動がSIGWINCH到達に間に合わず、
   * かつ一度取りこぼすと再送しても二度と反映されないTUI」がポップアップ枠の半分程度の
   * 高さのまま固着するバグがあった（起動から十分後に届いたSIGWINCHでは追従できることを
   * 実験で確認済み。取りこぼしたSIGWINCHはOS側で再送されず、キー入力等アプリ内の
   * 別イベントが起きるまで反映されない）
   */
  function spawnSession(spawnCols: number, spawnRows: number): void {
    if (!tabId || !pendingOpts || !pendingInherited) return;
    const popupOpts = pendingOpts;
    const inherited = pendingInherited;
    pendingOpts = null;
    pendingInherited = null;
    cols = spawnCols;
    rows = spawnRows;
    session = createSession({
      cols: spawnCols,
      rows: spawnRows,
      shell,
      cwd: popupOpts.cwd ?? inherited.cwd,
      command: popupOpts.command,
      captureStdoutTo: captureFile ?? undefined,
      env: {
        NIWATERM_TAB_ID: tabId,
        NIWATERM_SOCKET: ipcSocketPath(),
        NIWATERM_BRIDGE_PORT: String(WSL_BRIDGE_PORT),
      },
      onOutput: () => opts.onDirty(),
      onExit: () => close(),
      onPwdChanged: (cwd) => vars.set("cwd", cwd),
    });
  }

  function settleCloseWaiters(output: string | undefined): void {
    const waiters = closeWaiters;
    closeWaiters = [];
    for (const resolve of waiters) resolve(output);
  }

  /** captureFileが残っていれば読み込んで削除する。読めなければundefined（ベストエフォート） */
  function consumeCaptureFile(): string | undefined {
    if (!captureFile) return undefined;
    const file = captureFile;
    captureFile = null;
    let output: string | undefined;
    try {
      output = readFileSync(file, "utf8");
    } catch {}
    try {
      unlinkSync(file);
    } catch {}
    return output;
  }

  /**
   * ポップアップを開く。既に開いていれば何もしない（同時に1つだけ、ADR 0005）。
   * commandを指定すると、デフォルトシェル（WSLプロファイル等も含む）の-c/-Command相当で
   * そのコマンドをexecする（ワンショット実行、pty.tsのappendCommandArgs参照）。
   * execで置き換わるため、コマンド終了=シェルプロセス終了となりPTYのonExitが自然に発火し、
   * 自動的に閉じる（明示的なexit送信は不要）。
   */
  function open(popupOpts: OpenPopupOptions, inherited: InheritedTabSnapshot): TabId | null {
    if (tabId) return null;
    const newTabId = opts.genTabId();
    const resolvedShell = opts.getDefaultShell?.();
    shell = resolvedShell;
    // 継承元タブのサイズを暫定値として持っておく（PTY起動前でもsnapshot/promotion等が
    // 参照できるように）。実際の起動サイズはhandleResize到達時にspawnSessionが上書きする
    cols = inherited.cols;
    rows = inherited.rows;
    vars.clear();
    captureFile =
      popupOpts.captureStdout && popupOpts.command !== undefined
        ? join(tmpdir(), `niwaterm-popup-capture-${newTabId}.out`)
        : null;
    tabId = newTabId;
    visible = true;
    width = popupOpts.width;
    height = popupOpts.height;
    pendingOpts = popupOpts;
    pendingInherited = inherited;
    opts.onDirty();
    return newTabId;
  }

  function close(): boolean {
    if (!tabId) return false;
    session?.dispose();
    const output = consumeCaptureFile();
    reset();
    opts.onDirty();
    settleCloseWaiters(output);
    return true;
  }

  /**
   * ポップアップが閉じる（または昇格して「開いていない」状態に戻る）まで待つ。
   * 既に閉じている場合は即座に解決する（`popup open --wait`のCLI応答用、ADR 0005拡張）。
   * 解決値はcaptureStdout指定時のキャプチャ結果（`popup open --wait --capture-stdout`用）
   */
  function waitForClose(): Promise<string | undefined> {
    if (!tabId) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      closeWaiters.push(resolve);
    });
  }

  /** ポップアップの表示/非表示を切り替える。戻り値はトグル後の可視状態。popupが開いていなければnull */
  function toggleVisibility(): boolean | null {
    if (!tabId) return null;
    visible = !visible;
    opts.onDirty();
    return visible;
  }

  /**
   * 開いているポップアップの中身を呼び出し側（board.tsのadoptTab）へ渡すために取り出す。
   * 以後このポップアップは「閉じている」状態になる（PTYセッションはdisposeしない。所有権の移転のみ）
   */
  function takeForPromotion(): PromotedPopup | null {
    if (!tabId) return null;
    // resize未到達のまま昇格されるケース（webview到達前のごく短い競合、テスト等）向けの
    // フォールバック。継承サイズのまま起動してでも昇格自体は必ず成功させる
    if (pendingOpts) spawnSession(cols, rows);
    if (!session) return null;
    const promoted: PromotedPopup = {
      tabId,
      session,
      cols,
      rows,
      shell,
      vars: vars.size > 0 ? Object.fromEntries(vars) : undefined,
    };
    // 昇格はPTYを継続実行するため、キャプチャ結果はまだ確定しない（ベストエフォートで掃除のみ）
    consumeCaptureFile();
    reset();
    opts.onDirty();
    settleCloseWaiters(undefined);
    return promoted;
  }

  function hasTab(id: TabId): boolean {
    return tabId === id;
  }

  function handleInput(data: string): void {
    session?.write(data);
  }

  function handlePaste(data: string): void {
    session?.paste(data);
  }

  function handleMouseEvent(ev: MouseEventInput): void {
    session?.mouseEvent(ev);
  }

  // スクロールはPTYを経由しないため、呼び出し側で明示的にonDirty()し再描画をスケジュールする必要がある
  function handleScroll(deltaLines: number): void {
    if (!session) return;
    session.scroll(deltaLines);
    opts.onDirty();
  }

  function handleScrollToTop(): void {
    if (!session) return;
    session.scrollToTop();
    opts.onDirty();
  }

  function handleScrollToBottom(): void {
    if (!session) return;
    session.scrollToBottom();
    opts.onDirty();
  }

  function handleResize(c: number, r: number, cellWidthPx: number, cellHeightPx: number): void {
    if (pendingOpts) {
      spawnSession(c, r);
      // 生成時はcols/rowsしか渡らないため、セルの実寸はここで伝える（マウスレポートの座標変換に必要）
      session?.setCellSize(cellWidthPx, cellHeightPx);
      opts.onDirty();
      return;
    }
    if (!session) return;
    if (session.resize(c, r, cellWidthPx, cellHeightPx)) {
      cols = c;
      rows = r;
      opts.onDirty();
    }
  }

  function getTabText(): string | null {
    return session?.dumpText() ?? null;
  }

  /** 中身のrenderState（HTML等）。既存タブ更新ループへ同居させるため呼び出し側が使う */
  function renderState(): TerminalRenderState | null {
    return session?.renderState() ?? null;
  }

  function snapshot(): PopupRenderState | null {
    return tabId ? { tabId, visible, width, height } : null;
  }

  /** サイドバー一覧用の軽量な参照。非アクティブなWorkspaceでもポップアップの有無・表示状態を把握できるようにする */
  function getInfo(): { tabId: TabId; visible: boolean } | null {
    return tabId ? { tabId, visible } : null;
  }

  function dispose(): void {
    session?.dispose();
    consumeCaptureFile();
    reset();
    settleCloseWaiters(undefined);
  }

  return {
    open,
    close,
    waitForClose,
    toggleVisibility,
    takeForPromotion,
    hasTab,
    handleInput,
    handleMouseEvent,
    handlePaste,
    handleScroll,
    handleScrollToTop,
    handleScrollToBottom,
    handleResize,
    getTabText,
    renderState,
    snapshot,
    getInfo,
    dispose,
  };
}

export type Popup = ReturnType<typeof createPopup>;
