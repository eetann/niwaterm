import Electrobun, {
  ApplicationMenu,
  BrowserView,
  BrowserWindow,
  type RPCSchema,
  Screen,
  Utils,
} from "electrobun/bun";
import { APP_VARIANT } from "./app-variant.generated";
import type {
  KeybindingsConfig,
  LayoutsConfig,
  NiwaBellEvent,
  NiwaBellHandler,
  NiwaLinkEvent,
  NiwaLinkHandler,
  NiwaNotifyOptions,
  ResolvedAppearanceConfig,
  ResolvedBoardConfig,
  ResolvedBoardPhase,
  ResolvedBrowserConfig,
  ResolvedCustomViewConfig,
  ResolvedLinkConfig,
  ResolvedMouseConfig,
  ResolvedTerminalConfig,
  ShellProfile,
} from "@niwaterm/config";
import { defaultBoardConfig, scaleLineHeight } from "@niwaterm/config";
import { AGENT_STATUS_TAB_VAR } from "./board";
import { applyAndBindStartupLayout } from "./board-startup";
import { isBuiltinLayoutName } from "./builtin-layouts";
import { createBrowserBridge } from "./browser-bridge";
import { captureUrlScreenshot } from "./browser-screenshot";
import { readClipboardText, setClipboardWriteListener, writeClipboardText } from "./clipboard";
import {
  cleanupConfigImportDir,
  configFilePath,
  decideConfigLoadOutcome,
  loadAndResolveConfig,
} from "./config";
import type { ConfigDiagnostic } from "./config-diagnostics";
import { buildConfigSummary, type ConfigSummary } from "./config-summary";
import { watchConfigFile } from "./config-watcher";
import type { CustomViewCallResult, CustomViewHandlersHandle } from "./custom-view-handlers";
import { createDirExistenceCache, dirExistsSync } from "./dir-existence";
import type { MouseEventInput } from "./ghostty";
import { createIpcServer, ipcSocketPath, type IpcServer } from "./ipc-server";
import { applyBuiltinLayout, applyLayoutPreset, type ApplyLayoutResult } from "./layout-apply";
import { listResolvedLayouts, loadProjectPreset, type LayoutListEntry } from "./project-config";
import { DEFAULT_RESIZE_AMOUNT } from "./niwa-api";
import { isAllowedLinkUrl } from "./open-link";
import { resolveBoardNewTabCwd, resolveWorktreeInputPath } from "./board-worktree";
import { loadPersistedState, persistedFilePath, savePersistedState } from "./persistence";
import type { SelectionMenuEntry, SelectionMenuHandle } from "./selection-menu";
import { detectShellProfiles, resolveShellProfileCommand } from "./shell-profiles";
import type { SplitOrientation, SplitPlacement, TabId, TileId } from "./tile-layout";
import { enableWindowTransparency } from "./win-window";
import { sendWindowsNotification } from "./windows-notification";
import { createMacNotifier } from "./mac-notification";
import {
  defaultWindowFrame,
  isFrameRestorable,
  loadWindowState,
  resolveWindowFrame,
  saveWindowState,
  type ScreenArea,
  type WindowFrame,
  windowStateFilePath,
} from "./window-state";
import { createWindowManager, type WindowId, type WindowOps } from "./window-manager";
import type { AppRenderState, BoardId, WorkspaceId } from "./workspace-manager";

// macOSではメニューが無いとCmd+C/Cmd+V等のkey equivalentがWebViewに届かないため、標準メニューを設定する。
// これはmacOS固有の事情（key equivalentがメニュー経由で配送される）への対処なので他OSでは設定しない
if (process.platform === "darwin") {
  ApplicationMenu.setApplicationMenu([
    {
      label: "niwaterm",
      submenu: [
        { role: "hide", accelerator: "Command+H" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "divider" },
        { role: "quit", accelerator: "Command+Q" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo", accelerator: "Command+Z" },
        { role: "redo", accelerator: "Command+Shift+Z" },
        { type: "divider" },
        { role: "cut", accelerator: "Command+X" },
        { role: "copy", accelerator: "Command+C" },
        { role: "paste", accelerator: "Command+V" },
        { role: "selectAll", accelerator: "Command+A" },
      ],
    },
  ]);
}

export type NiwaRPC = {
  bun: RPCSchema<{
    requests: {
      /**
       * サイドバーの起動時レイアウトメニューに並べるプリセット一覧。プロジェクトローカルの
       * プリセットは対象Boardのフォーカス中タブのcwdから解決するため、そのBoardのタブで
       * `niwaterm layout list`を叩いたのと同じ結果になる
       */
      listBoardLayouts: {
        params: { boardId: BoardId };
        response: { layouts: LayoutListEntry[] };
      };
      /**
       * 選択範囲を右クリックした時に出すユーザー定義項目（mouse.selectionMenu）。
       * 項目のrunはbun側に残るため、webviewへはidとラベルだけを返す
       */
      selectionMenuItems: {
        params: { tabId: TabId; text: string };
        response: { items: SelectionMenuEntry[] };
      };
    };
    messages: {
      log: { msg: string };
      ready: {};
      input: { tabId: TabId; data: string };
      paste: { tabId: TabId; data: string };
      /** マウスレポート有効時（TUIアプリ等）にwebviewから転送されるマウス操作 */
      mouseEvent: { tabId: TabId; event: MouseEventInput };
      /** vi風コピーモードへ入る（キーバインド・コマンドパレットから） */
      enterCopyMode: { tabId: TabId };
      /** コピーモード中のキー入力。未割当キーはbun側で無視する */
      copyModeKey: { tabId: TabId; key: string; ctrl: boolean };
      scroll: { tabId: TabId; deltaLines: number };
      scrollToTop: { tabId: TabId };
      scrollToBottom: { tabId: TabId };
      /** OSC 133のプロンプトマークを辿ってビューポートを前後のコマンドへ動かす */
      jumpPrompt: { tabId: TabId; direction: "up" | "down" };
      copySelection: { text: string };
      pasteFromClipboard: { tabId: TabId };
      /** ターミナル出力の中のリンク（OSC 8・link.rulesのどちらも）のクリック */
      openLink: { tabId: TabId; url: string; text: string };
      resize: {
        tabId: TabId;
        cols: number;
        rows: number;
        cellWidth: number;
        cellHeight: number;
      };
      splitTile: { tileId: TileId; orientation: SplitOrientation };
      newTab: { tileId: TileId; shellProfileId?: string; cwd?: string };
      newBrowserTab: { tileId: TileId; url?: string };
      /** viewId省略時は先頭のcustomView（`new-custom-view-tab`キーバインドからの経路がこれ） */
      newCustomViewTab: { tileId: TileId; viewId?: string };
      openPopup: {};
      closePopup: {};
      togglePopupVisibility: {};
      promotePopup: {};
      zoomFontSize: { delta: number };
      resetFontSizeZoom: {};
      switchTab: { tileId: TileId; tabId: TabId };
      moveTab: { fromTileId: TileId; tabId: TabId; toTileId: TileId };
      /** タブをタイルの端へドロップしての画面分割。targetTileIdを分割し、生まれた新タイルへタブを移す */
      moveTabToSplit: {
        fromTileId: TileId;
        tabId: TabId;
        targetTileId: TileId;
        orientation: SplitOrientation;
        placement: SplitPlacement;
      };
      closeTab: { tileId: TileId; tabId: TabId };
      /** mainview側のConfirmDialogで確認済みのタブ再起動要求（niwa.tab.respawnと同機構、常にデフォルトシェル・元cwd引き継ぎ） */
      restartTab: { tabId: TabId };
      focusTile: { tileId: TileId };
      focusDirection: { direction: "up" | "down" | "left" | "right" };
      toggleZoomTile: { tileId: TileId };
      resizeTileInDirection: { direction: "up" | "down" | "left" | "right" };
      resizeSplit: { splitId: TileId; ratio: number };
      newWorkspace: {};
      /** 一時ウィンドウ（前回の状態を復元せず、閉じても何も残さないOSウィンドウ）を開く */
      newWindow: {};
      /** close-windowアクションからの、このwebviewが載っているOSウィンドウを閉じる要求 */
      closeWindow: {};
      /** quit-appアクションからの、mainview側のConfirmDialogで確認済みのniwaterm終了要求 */
      quitApp: {};
      switchWorkspace: { workspaceId: WorkspaceId };
      /** サイドバーのD&D・move-workspace-*キーバインドからの並び替え。toIndexは0始まり（範囲外はbun側でクランプ） */
      moveWorkspace: { workspaceId: WorkspaceId; toIndex: number };
      closeWorkspace: { workspaceId: WorkspaceId };
      newBoard: { workspaceId: WorkspaceId; cwd?: string };
      switchBoard: { boardId: BoardId };
      /** サイドバーのD&D・move-board-*キーバインドからの並び替え。toIndexは所属ワークスペース内の0始まりの位置（範囲外はbun側でクランプ） */
      moveBoard: { boardId: BoardId; toIndex: number };
      /**
       * サイドバーの別ワークスペースへのD&D・move-board-to-workspaceのピッカーからの移動。
       * toIndexは移動先ワークスペース内の0始まりの挿入位置で、省略時は末尾。
       * 移動元が空になる（＝そのワークスペースが畳まれる）場合の確認はwebview側が取ってから送る
       */
      moveBoardToWorkspace: { boardId: BoardId; workspaceId: WorkspaceId; toIndex?: number };
      closeBoard: { boardId: BoardId };
      renameTab: { tabId: TabId; name: string };
      renameTile: { tileId: TileId; name: string };
      renameWorkspace: { workspaceId: WorkspaceId; name: string };
      renameBoard: { boardId: BoardId; name: string };
      /**
       * set-board-worktreeアクション・サイドバーの右クリックからのワークツリー紐づけの張り替え。
       * pathは入力欄の生の値（相対パス可。空文字列とnullは紐づけ解除）で、絶対パスへの解決はbun側で行う
       */
      setBoardWorktreePath: { boardId: BoardId; path: string | null };
      /**
       * サイドバーの右クリック・set-board-phase:<id>アクションからの作業フェーズの切り替え。
       * phaseはboard.phasesのidか任意の文字列で、nullは解除
       */
      setBoardPhase: { boardId: BoardId; phase: string | null };
      /**
       * サイドバーの右クリックからのレイアウト適用。選んだプリセットをそのBoardへ今すぐ適用し、
       * 起動時レイアウトとしても紐づける（CLIの`layout apply --replace --startup`と同じ）。
       * 既存タブを閉じる確認と、プロジェクトローカル由来の場合のtrust確認はwebview側で取ってから送る
       */
      applyBoardLayout: { boardId: BoardId; preset: string; trust?: boolean };
      /** サイドバーの右クリックからの起動時レイアウトの紐づけ解除（CLIの`board startup clear`と同じ） */
      clearBoardStartup: { boardId: BoardId };
      /** keybindingsのBindingTargetがkind:"custom"の場合に発火する。handlerIdはniwa-api.tsのhandlerRegistryのキー */
      runKeybindHandler: { handlerId: string };
      /** 右クリックメニューで選ばれたユーザー定義項目。idはselectionMenuItemsで返したもの */
      runSelectionMenuItem: { id: string };
      /**
       * customViewのHTMLがniwaterm.callで呼んだユーザー定義ハンドラ（customViews[].handlers）。
       * 関数の実体はbun側にあるため、webviewはビューのidと名前・payloadだけを送ってくる
       * （ハンドラ名はビューごとに独立しているため、名前だけでは実体を引けない）。
       * requestではなくmessageなのは、ハンドラがgit操作・依存インストール等でいくらでも長くなりうるためで、
       * 結果はcustomViewCallResultで返す（RPCのmaxRequestTimeで打ち切られると、
       * 実際には完了した操作がHTML側でエラー表示される）
       */
      customViewCall: { callId: string; viewId: string; name: string; payload: unknown };
      /** reload-configキーバインド・コマンドパレットからの手動リロード要求。ファイル監視での自動リロードと同じhandleConfigFileChangedを呼ぶ */
      reloadConfig: {};
      /** そのウィンドウのフォーカス状態。ベルの通知要否・既読判定に使う */
      windowFocusChanged: { focused: boolean };
    };
  }>;
  webview: RPCSchema<{
    requests: {
      /** ブラウザタブのURLを遷移する。次のdom-ready（またはmainview側の内部タイムアウト）まで待って解決する */
      browserNavigate: {
        params: { tabId: TabId; url: string };
        response: { ok: true } | { ok: false; error: string };
      };
      /**
       * ブラウザタブ（OOPIF）内でJSを実行し、host-message経由の結果を待って返す汎用プリミティブ。
       * MVPではgetText/getHTML用の固定コードのみbun側から渡す想定
       * （CLIから任意JSを直接指定できるようにはしない。click/fill実装時にセキュリティ境界を再検討する）
       */
      execBrowserJs: {
        params: { tabId: TabId; code: string };
        response: { ok: true; result: unknown } | { ok: false; error: string };
      };
    };
    messages: {
      render: AppRenderState;
      config: {
        keybindings: KeybindingsConfig;
        appearance: ResolvedAppearanceConfig;
        mouse: ResolvedMouseConfig;
        /** ターミナル出力の中のURL判定ルールと、開くのに押しておく修飾キー（openはbun側で使う） */
        link: ResolvedLinkConfig;
        customViews: ResolvedCustomViewConfig[];
        shellProfiles: ShellProfile[];
        /** Boardへ付けられるフェーズの候補（board.phases）。サイドバーのメニュー・コマンドパレットに並ぶ */
        boardPhases: ResolvedBoardPhase[];
        /** 設定モーダル（show-config）に出す現在の設定値。CLIの`niwaterm config show`と同じ内容 */
        configSummary: ConfigSummary;
      };
      copied: { chars: number; lines: number };
      /**
       * サイドバーに出すビューの指定（CLIの`niwaterm sidebar switch`から）。viewIdは
       * customViewのidかワークスペース一覧のid。存在確認はIPCサーバー側で済んでいる
       */
      setSidebarView: { viewId: string };
      /** customViewCallの結果。callIdは呼び出し元のwebviewが発行したもの */
      customViewCallResult: CustomViewCallResult & { callId: string };
    };
  }>;
};

/**
 * OSウィンドウ1枚ぶんの、描画側（Electrobun側）の状態。中身（Workspace以下）は
 * window-manager.tsが持ち、ここが持つのはBrowserWindow・rpcと描画のコアレス状態だけ
 */
interface WindowView {
  windowId: WindowId;
  browserWindow: InstanceType<typeof BrowserWindow>;
  /** OSのフォーカスがこのウィンドウにあるか（webview側のfocus/blurから届く）。ベルの扱いを分けるのに使う */
  focused: boolean;
  /** webviewの中身へOSキーボードフォーカスを渡し済みか（readyは再送されうるので1回だけ渡す） */
  webviewFocused: boolean;
  renderScheduled: boolean;
  /** 前回webviewへ送ったパレットCSS（dropUnchangedPaletteCss参照） */
  lastPaletteCssByTabId: Map<TabId, string>;
  /** 保存対象のウィンドウ枠。一時ウィンドウでは保存しないので参照されない */
  frame: WindowFrame;
  frameSaveScheduled: boolean;
  /** 後始末が済んでいるか。OSのクローズとwindow-manager側の終了の両方から閉じられるため持つ */
  closed: boolean;
}

const views = new Map<WindowId, WindowView>();

/**
 * そのウィンドウのwebviewへメッセージを送る口。ウィンドウ生成直後はまだrpcが立っておらず、
 * PTYの初回出力等からの描画要求が先に来ることがあるため、都度引き直してnullチェックする
 */
function rpcSendOf(windowId: WindowId): any | null {
  const view = views.get(windowId);
  if (!view || view.closed) return null;
  return (view.browserWindow.webview.rpc as any)?.send ?? null;
}

// 描画は16msでコアレス（連続出力時のRPC洪水を防ぐ）
function scheduleRender(windowId: WindowId) {
  const view = views.get(windowId);
  if (!view || view.renderScheduled) return;
  view.renderScheduled = true;
  setTimeout(() => {
    view.renderScheduled = false;
    render(windowId);
  }, 16);
}

/** 全ウィンドウを描き直す（設定変更・フォントサイズ変更など、どのウィンドウにも効く変化） */
function scheduleRenderAll() {
  for (const windowId of views.keys()) scheduleRender(windowId);
}

function render(windowId: WindowId) {
  const view = views.get(windowId);
  const rpcSend = rpcSendOf(windowId);
  if (!view || !rpcSend) return;
  // 画面に出ているタブのベルは既読として消す。描画のたびに拾うことで、タブ切替・Board切替・
  // ワークスペース切替・ウィンドウのフォーカス復帰のどの経路でも取りこぼさない
  if (view.focused) windowManager.clearBellOnVisibleTabs(windowId);
  const snap = windowManager.snapshotOf(windowId);
  if (!snap) return;
  dropUnchangedPaletteCss(view, snap);
  view.browserWindow.setTitle(
    snap.workspaceIds.length === 1
      ? APP_VARIANT
      : `${APP_VARIANT} — Workspace ${snap.workspaceIds.indexOf(snap.activeWorkspaceId) + 1}/${snap.workspaceIds.length}`,
  );
  rpcSend.render(snap);
}

/**
 * 前回webviewへ送ったのと同じパレットCSSをnullへ潰す。パレットは6KB強ある一方、
 * OSC 4等で塗り替えられない限り変わらないため、毎フレーム運ぶとRPCのペイロードが
 * 無駄に膨らむ。webviewは受け取ったパレットを保持して次回以降も使い回す（mainview側の
 * applyPaletteCss）ので、送り直しは内容が変わったときだけでよい。
 * 保持はウィンドウごと（webviewごと）に分ける
 */
function dropUnchangedPaletteCss(view: WindowView, snap: AppRenderState): void {
  const board = snap.workspace.board;
  if (!board) return;
  // popupのPTY描画状態もboard.tabsに同居しているため、ここを見るだけで両方拾える
  for (const [tabId, state] of Object.entries(board.tabs)) {
    if (state.kind !== "terminal" || state.paletteCss === null) continue;
    if (view.lastPaletteCssByTabId.get(tabId) === state.paletteCss) state.paletteCss = null;
    else view.lastPaletteCssByTabId.set(tabId, state.paletteCss);
  }
}

/** 設定はアプリ全体で共通なので、windowId省略時は全ウィンドウへ送る */
function sendConfig(windowId?: WindowId) {
  const targets = windowId !== undefined ? [windowId] : [...views.keys()];
  for (const id of targets) {
    const rpcSend = rpcSendOf(id);
    if (!rpcSend) continue;
    rpcSend.config({
      keybindings,
      appearance: effectiveAppearance(),
      mouse,
      link: linkConfig,
      customViews,
      shellProfiles,
      boardPhases: boardConfig.phases,
      configSummary: currentConfigSummary(),
    });
  }
}

/**
 * customViewのniwaterm.callの結果を返す。callIdはwebview側がウィンドウごとに重複しない形で
 * 発行するため、どのウィンドウのcustomViewからの呼び出しかを保持せず全ウィンドウへ送ってよい
 * （自分が出したcallIdでなければwebview側が無視する）
 */
function sendCustomViewCallResult(callId: string, result: CustomViewCallResult): void {
  for (const id of views.keys()) {
    rpcSendOf(id)?.customViewCallResult({ callId, ...result });
  }
}

/**
 * viewId指定があればそのidのcustomView、省略時は先頭のもの。該当が無ければnull
 * （`new-custom-view-tab`キーバインドはビューを指定しないため先頭へ落ちる）
 */
function findCustomView(viewId?: string): ResolvedCustomViewConfig | null {
  if (viewId === undefined) return customViews[0] ?? null;
  return customViews.find((view) => view.id === viewId) ?? null;
}

/**
 * サイドバーに出すビューを切り替える（CLIの`niwaterm sidebar switch`から）。サイドバーの表示状態は
 * ウィンドウごとにwebview側が持つため、呼び出し元タブのウィンドウ（不明ならフォーカス中）へ送る
 */
function sendSidebarView(viewId: string, windowId: WindowId | null): void {
  rpcSendOf(windowId ?? windowManager.getFocusedWindowId())?.setSidebarView({ viewId });
}

/**
 * クリップボードへ入った直後にwebviewへ知らせる（コピー完了バッジ用）。マウス選択・キーバインド・
 * コピーモードのどの経路でも同じ表示にするため、clipboard.tsの書き込み口から一括で拾う。
 * 表示先タブはwebview側が決めるためここでは送らない
 */
function sendCopied(text: string): void {
  // コピーは操作しているウィンドウで起きるため、バッジもフォーカス中ウィンドウにだけ出す
  const rpcSend = rpcSendOf(windowManager.getFocusedWindowId());
  if (!rpcSend) return;
  // 末尾の改行は数えない（行末まで選択したときに1行多く見える・空コピーで0文字と出るのを防ぐ）
  const body = text.replace(/\n+$/u, "");
  if (body === "") return;
  rpcSend.copied({ chars: [...body].length, lines: body.split("\n").length });
}
setClipboardWriteListener(sendCopied);

// キーバインド・CLI・コマンドパレットからの実行時フォントサイズ変更（configファイルの
// appearance.fontSizeとは独立したズーム量として保持する）。設定ファイルのホットリロードでは
// リセットしない: ユーザーの直近の調整はconfig編集後も維持されるべきという判断
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 48;
const FONT_SIZE_STEP = 1;
let fontSizeZoomDelta = 0;

function clampFontSize(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
}

function effectiveAppearance(): ResolvedAppearanceConfig {
  if (fontSizeZoomDelta === 0) return appearance;
  const fontSize = clampFontSize(appearance.fontSize + fontSizeZoomDelta);
  return { ...appearance, fontSize, lineHeight: scaleLineHeight(appearance, fontSize) };
}

function adjustFontSize(delta: number): number {
  const clamped = clampFontSize(appearance.fontSize + fontSizeZoomDelta + delta);
  fontSizeZoomDelta = clamped - appearance.fontSize;
  sendConfig();
  return clamped;
}

function resetFontSizeZoom(): number {
  fontSizeZoomDelta = 0;
  sendConfig();
  return appearance.fontSize;
}

/**
 * ウィンドウ枠の保存先。前回のサイズ・位置を復元するのはメインウィンドウだけで、
 * 一時ウィンドウは既定の枠を少しずつずらして重ねる（ブラウザの新規ウィンドウと同じ扱い）
 */
const windowFramePath = windowStateFilePath();

/**
 * workspaces.jsonへ今すぐ書き出す。書き出すのはメインウィンドウの中身だけで、
 * メインウィンドウが閉じた後（一時ウィンドウだけが残っている状態）は何もしない。
 * 一時ウィンドウの中身で前回の状態を上書きしないため
 */
function savePersistedStateNow(): void {
  const state = windowManager.persistentState();
  if (state === null) return;
  savePersistedState(persistedFilePath(), state).catch((err: unknown) => {
    console.log(`[bun] failed to save persisted state: ${String(err)}`);
  });
}

// レイアウト骨格の永続化は500msでコアレス（連続ドラッグ等での書き込み過多を防ぐ）
let persistScheduled = false;
function schedulePersist() {
  if (persistScheduled) return;
  persistScheduled = true;
  setTimeout(() => {
    persistScheduled = false;
    savePersistedStateNow();
  }, 500);
}

function onDirty(windowId: WindowId) {
  scheduleRender(windowId);
  // 一時ウィンドウの変化は保存しない（閉じた後に何も残さないのが一時ウィンドウの約束）
  if (windowManager.isPersistent(windowId)) schedulePersist();
}

let ipcServer: IpcServer | null = null;

/** 最後のウィンドウが閉じてからプロセスを落とすまでの猶予(ms)。CLIへレスポンスを返し切るため */
const EXIT_GRACE_MS = 100;

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  configWatcher.close();
  worktreeExistence.dispose();
  windowManager.dispose();
  ipcServer?.close();
  cleanupConfigImportDir();
}

/**
 * quit-appアクションからのniwaterm自体の終了。Electrobunはprocess.exitを上書きしており、
 * before-quitイベント（ウィンドウ枠・レイアウト骨格の保存＋cleanup）を経てネイティブ側の
 * 終了シーケンスへ入るため、Cmd+Qやメニューからの終了と同じ道筋になる。
 * ハンドラの中から同期的に落とすと呼び出し元へ応答を返す前にプロセスが消えるため、
 * 返し終える余地を残してから落とす
 */
function quitApp(): void {
  setTimeout(() => {
    process.exit(0);
  }, EXIT_GRACE_MS);
}

let userConfigLoaded: boolean;
/** 直近の読み込み試行が失敗した理由。成功・ファイル不在ならnull */
let configLoadError: string | null = null;
/** 今効いている設定を解決したときに出た警告。読み込みに失敗した回のぶんでは上書きしない */
let configDiagnostics: ConfigDiagnostic[] = [];
let keybindings: KeybindingsConfig;
let appearance: ResolvedAppearanceConfig;
let browser: ResolvedBrowserConfig;
// 復元したBoardの自動名は設定の読み込みより前に決まる（windowManagerの生成時）ため、
// 未読込の間も方式を引けるよう既定値で初期化しておく
let boardConfig: ResolvedBoardConfig = defaultBoardConfig;
let terminalConfig: ResolvedTerminalConfig;
let customViews: ResolvedCustomViewConfig[];
let customViewHandlers: CustomViewHandlersHandle;
let defaultShell: string | undefined;
let shellProfiles: ShellProfile[];
let layouts: LayoutsConfig;
let mouse: ResolvedMouseConfig;
let selectionMenu: SelectionMenuHandle;
let workspaceDefaultCwd: string | undefined;
let runKeybindHandler: (id: string) => Promise<void>;
let bellHandler: NiwaBellHandler | null;
let runDefaultBell: (event: NiwaBellEvent) => void;
let linkConfig: ResolvedLinkConfig;
let linkHandler: NiwaLinkHandler | null;
let runDefaultOpenLink: (event: NiwaLinkEvent) => void;

// WSLディストロの増減は稀なイベントのため起動時に1回だけ検出し、ホットリロードのたびには
// wsl.exeを呼び直さない（アプリ再起動で反映されれば十分という判断）
const detectedShellProfiles = await detectShellProfiles();

const restoreFrom = await loadPersistedState(persistedFilePath());

// ElectrobunのUtils.showNotificationはWindows実機で機能せず（windows-notification.ts参照）、
// macOSではクリックされた通知を識別できない（mac-notification.ts参照）ため、両OSとも自前実装に
// 差し替える。macOSのヘルパーが未ビルドの場合だけElectrobun実装へフォールバックする
const macNotifier = createMacNotifier();
const sendNotification: (opts: NiwaNotifyOptions) => void =
  process.platform === "win32"
    ? sendWindowsNotification
    : (macNotifier?.send ?? Utils.showNotification);

// Boardに紐づくワークツリーが消えていないかの監視。renderのたびに同期statを打つわけにいかないため
// キャッシュ越しに引く（dir-existence.ts）
const worktreeExistence = createDirExistenceCache({ onChange: scheduleRenderAll });

// niwa.tile/tab/popup等のAPI（設定ファイルの関数ハンドラから呼ばれる）がwindowManagerを
// 操作するため、config読み込み（refreshConfig）より先にwindowManagerを作る必要がある。
// getDefaultShell/getDefaultCwdは遅延評価のクロージャなので、生成時点でdefaultShell等が
// 未確定（refreshConfig未実行）でも問題ない
const windowManager = createWindowManager({
  initialCols: 80,
  initialRows: 24,
  onDirty,
  restoreFrom,
  getDefaultShell: () => defaultShell,
  getDefaultCwd: () => workspaceDefaultCwd,
  // 新しいタブを開く瞬間にしか通らないので、ここだけは同期のstatで最新の存在を確かめる
  // （紐づけ先が消えていると気づかずPTYの起動自体が失敗するため）
  getNewTabCwd: (worktreePath) =>
    resolveBoardNewTabCwd(boardConfig.newTabCwd, worktreePath, dirExistsSync),
  getBoardNaming: () => boardConfig.naming,
  getMaxScrollback: () => terminalConfig.scrollback,
  isWorktreeMissing: (worktreePath) => worktreeExistence.isMissing(worktreePath),
  onBell: handleBell,
  onWindowOpened: (windowId) => {
    createWindowView(windowId, frameForNewWindow());
  },
  onWindowClosed: (windowId) => {
    finalizeWindow(windowId, true);
  },
  onAllWindowsClosed: () => {
    console.log("all windows closed, exiting");
    // 最後の1枚をCLI（`window close`・`tab close`）から閉じた場合、ここで同期的にexitすると
    // レスポンスを返す前にプロセスが消え、CLI側には接続エラーだけが残る。
    // 返し終える余地を残してから落とす
    setTimeout(() => {
      cleanup();
      process.exit(0);
    }, EXIT_GRACE_MS);
  },
});

/**
 * タブがBEL文字を出力した時の処理。niwa.on("bell", ...)が登録されていればそちらへ丸ごと委ね、
 * 無ければ既定の処理（マーク＋画面に出ていないタブなら通知）を行う
 */
function handleBell(tabId: TabId): void {
  const location = windowManager.locateTab(tabId);
  if (!location) return;
  const windowId = windowManager.windowIdOfTab(tabId);
  const agentStatus = windowManager.getTabVar(tabId, AGENT_STATUS_TAB_VAR);
  const event: NiwaBellEvent = {
    tabId,
    tabName: windowManager.getTabName(tabId),
    tileId: location.tileId,
    boardId: location.boardId,
    workspaceId: location.workspaceId,
    // ベルを鳴らしたタブが載っているウィンドウのフォーカス状態。別ウィンドウを見ている間の
    // ベルは「手が離れている」扱いにしたいので、アプリ全体ではなくウィンドウ単位で見る
    windowFocused: windowId !== null && (views.get(windowId)?.focused ?? false),
    visible: windowManager.isTabVisible(tabId),
    agentStatus: agentStatus.found ? agentStatus.value : null,
  };
  if (!bellHandler) {
    runDefaultBell(event);
    return;
  }
  Promise.resolve(bellHandler(event)).catch((err: unknown) => {
    console.log(`[bun] bell handler failed: ${String(err)}`);
  });
}

/**
 * ターミナル出力の中のリンクがクリックされた時の処理。niwa.on("open-link", ...)が登録されて
 * いればそちらへ丸ごと委ね、無ければ既定の処理（link.openの設定に従って開く）を行う。
 * URLはPTY越しの出力（リモートホスト由来を含む）なので、どちらへ渡す前にもスキームを検証する
 */
function handleOpenLink(tabId: TabId, url: string, text: string): void {
  if (!isAllowedLinkUrl(url)) {
    console.log(`[bun] blocked opening link with disallowed scheme: ${url}`);
    return;
  }
  // ポップアップのタブはタイルに属さず所在を引けないため、開き先のタイルはフォーカス中のものにする
  // （タイルが1つも無ければ空文字列。既定の処理はブラウザタブを作れず外部ブラウザへ倒れる）
  const tileId = windowManager.locateTab(tabId)?.tileId ?? windowManager.getFocusedTileId() ?? "";
  const cwd = windowManager.getTabVar(tabId, "cwd");
  const event: NiwaLinkEvent = {
    url,
    text,
    tabId,
    tileId,
    cwd: cwd.found ? cwd.value : undefined,
  };
  if (!linkHandler) {
    runDefaultOpenLink(event);
    return;
  }
  Promise.resolve(linkHandler(event)).catch((err: unknown) => {
    console.log(`[bun] open-link handler failed: ${String(err)}`);
  });
}

function currentConfigSummary(): ConfigSummary {
  return buildConfigSummary({
    configFile: configFilePath(),
    configFileLoaded: userConfigLoaded,
    loadError: configLoadError,
    diagnostics: configDiagnostics,
    appearance: effectiveAppearance(),
    baseFontSize: appearance.fontSize,
    baseLineHeight: appearance.lineHeight,
    keybindings,
    browser,
    customViews,
    defaultShell,
    shellProfiles,
    layouts,
    mouse,
    workspaceDefaultCwd,
    board: boardConfig,
    terminal: terminalConfig,
    link: linkConfig,
  });
}

/** 設定を一度でも適用したか。falseの間は失敗しても既定値を当てるしかない（残せる前の状態が無い） */
let configApplied = false;

/**
 * 設定ファイルを読み直して適用する。読めなかったときは既に適用済みの設定をそのまま残す:
 * 全項目を既定値へ落とすと、設定ファイル1箇所のtypoでprefixもテーマもカスタムビューも
 * 同時に消え、編集を戻すための操作すら効かなくなる。
 * 読めなかったことはconsole.logだけでは気づけないためデスクトップ通知でも知らせる
 * （同じ理由で直った時も1回だけ知らせる）。
 */
async function refreshConfig(): Promise<void> {
  const next = await loadAndResolveConfig(
    configFilePath(),
    windowManager,
    detectedShellProfiles,
    sendNotification,
    () => handleConfigFileChanged(),
    (url) => Utils.openExternal(url),
  );
  const outcome = decideConfigLoadOutcome({
    configFile: configFilePath(),
    loadError: next.loadError,
    previousError: configLoadError,
    alreadyApplied: configApplied,
  });
  configLoadError = next.loadError;
  if (outcome.notification) sendNotification(outcome.notification);
  if (!outcome.apply) return;

  ({
    userConfigLoaded,
    diagnostics: configDiagnostics,
    keybindings,
    appearance,
    browser,
    board: boardConfig,
    terminal: terminalConfig,
    customViews,
    customViewHandlers,
    defaultShell,
    shellProfiles,
    layouts,
    mouse,
    selectionMenu,
    workspaceDefaultCwd,
    runKeybindHandler,
    bellHandler,
    runDefaultBell,
    link: linkConfig,
    linkHandler,
    runDefaultOpenLink,
  } = next);
  configApplied = true;
  // 起動済みのタブはgetMaxScrollbackを読み直さないため、ここで今の値を配って回る
  windowManager.applyMaxScrollback(terminalConfig.scrollback);
  // 自動名は付いた時点の方式で固定されるので、方式を変えた分をここで付け直す
  windowManager.refreshBoardAutoNames();
}

await refreshConfig();

/**
 * 起動時レイアウト。restoreMode: "layout"のBoardは、保存した骨格ではなく
 * configのlayoutsプリセットで組み直す（タブのcommandも再実行される）。該当Boardは
 * workspace-manager側で骨格を復元せず単一タブの状態で作られているので、ここで組み立てる。
 *
 * 実行タイミングはconfig読み込み直後・BrowserView生成前に固定する。この時点では全タブが
 * まだPTY起動保留中（spawnSessionPending）で、プリセットのcommandも
 * sendInitialCommandで保留キューへ積まれるため、実測cols/rowsが確定してから正しいサイズで
 * 一度だけシェルが起動する。プリセットが見つからない場合は単一タブのまま残し、
 * ユーザーが気づけるよう通知する。
 *
 * projectRootが紐づいているBoardは、グローバル設定ではなくそのプロジェクトの
 * .niwaterm/config.tsから引く。起動時にはcwdが無いため探索は一切行わず、
 * 紐づけを作った時点で記録した解決元をそのまま読む。タブのcwdの基準も同じ理由で
 * 紐づけ時に記録したもの（tabCwd、無ければprojectRoot、無ければcwd）を使う
 */
async function applyStartupLayouts(): Promise<void> {
  for (const {
    boardId,
    preset,
    projectRoot,
    cwd,
    tabCwd,
  } of windowManager.listStartupLayoutBoards()) {
    // ビルトインは同名のユーザー定義プリセットが無いときだけ効く（resolveLayoutPresetByNameと同じ優先順位）
    const builtinName =
      !projectRoot && layouts[preset] === undefined && isBuiltinLayoutName(preset) ? preset : null;
    const layoutPreset = projectRoot
      ? await loadProjectPreset(projectRoot, preset)
      : layouts[preset];
    let result: ApplyLayoutResult;
    if (builtinName) {
      result = applyBuiltinLayout(windowManager, builtinName, boardId);
    } else if (layoutPreset) {
      result = applyLayoutPreset(windowManager, shellProfiles, layoutPreset, "replace", boardId, {
        ...(projectRoot ? { projectRoot } : {}),
        ...(cwd !== undefined ? { invocationCwd: cwd } : {}),
        ...(tabCwd !== undefined ? { tabBaseCwd: tabCwd } : {}),
      });
    } else {
      const source = projectRoot ? `${projectRoot}の.niwaterm/config.ts` : "設定";
      const message = `Board ${boardId}に紐づくレイアウトプリセット "${preset}" が${source}に見つかりません`;
      console.log(`[bun] ${message}`);
      sendNotification({ title: "起動時レイアウトを適用できません", body: message });
      continue;
    }
    if (!result.ok) {
      console.log(
        `[bun] failed to apply startup layout "${preset}" to ${boardId}: ${result.error}`,
      );
      sendNotification({
        title: "起動時レイアウトの適用に失敗しました",
        body: `${preset}: ${result.error}`,
      });
    }
  }
}

await applyStartupLayouts();

// 設定ファイル変更の検知→再読み込み→RPC送信をまとめて行う。実行中に次の変更が来たら
// 1回だけ追いかけて再実行する（多重実行の抑制）。scheduleRenderは無条件で呼ぶ:
// フォントサイズ変更でcols/rowsが変わらない場合でも、新しいcellWidth/cellHeightを
// 基準にカーソルpx位置を補正する必要があるため
let configReloadInFlight = false;
let configReloadPending = false;
async function handleConfigFileChanged(): Promise<void> {
  if (configReloadInFlight) {
    configReloadPending = true;
    return;
  }
  configReloadInFlight = true;
  try {
    await refreshConfig();
    sendConfig();
    scheduleRenderAll();
  } catch (err) {
    // ここまで漏れてくるのは設定の中身ではなくリロード処理自体の不具合。
    // 投げっぱなしにするとファイル監視のコールバック上でunhandled rejectionになる
    console.log(`[bun] config reload failed: ${String(err)}`);
    sendNotification({ title: "設定の再読み込みに失敗しました", body: String(err) });
  } finally {
    configReloadInFlight = false;
    if (configReloadPending) {
      configReloadPending = false;
      void handleConfigFileChanged();
    }
  }
}

/**
 * CLIへ渡すウィンドウ操作。closeWindowだけはwindow-manager直結にせず、閉じる前に
 * finalizeWindowを通す（OSのクローズボタンと同じ順序。window-manager側が先に畳むと
 * 持ち主が消えていて最終状態・ウィンドウ枠を書き出せない）
 */
const ipcWindowOps: WindowOps = {
  newWindow: (cwd) => windowManager.newWindow(cwd),
  closeWindow: (windowId) => {
    finalizeWindow(windowId, true);
    return windowManager.closeWindow(windowId);
  },
  listWindows: () => windowManager.listWindows(),
  windowIdOfTab: (tabId) => windowManager.windowIdOfTab(tabId),
  managerOf: (windowId) => windowManager.managerOf(windowId),
};

try {
  ipcServer = await createIpcServer(
    ipcSocketPath(),
    windowManager,
    () => customViews,
    (windowId) => activateWindow(windowId),
    createBrowserBridge(browserRpcOfTab),
    captureUrlScreenshot,
    () => shellProfiles,
    () => layouts,
    () => adjustFontSize(FONT_SIZE_STEP),
    () => adjustFontSize(-FONT_SIZE_STEP),
    () => resetFontSizeZoom(),
    sendNotification,
    () => keybindings,
    currentConfigSummary,
    ipcWindowOps,
    sendSidebarView,
  );
  console.log(`[bun] ipc server listening on ${ipcSocketPath()}`);
} catch (err) {
  console.log(`[bun] failed to start ipc server: ${String(err)}`);
}

// 通知のクリックはネイティブ側のキューに積まれるだけなので、ここで取り出して通知元タブへ遷移する
// （JSCallbackで直接受けない理由はsrc/native/macnotify.m参照）。遷移先のタブが既に閉じられていれば何もしない
const NOTIFICATION_CLICK_POLL_INTERVAL_MS = 300;
if (macNotifier) {
  setInterval(() => {
    for (
      let tabId = macNotifier.pollClickedTabId();
      tabId;
      tabId = macNotifier.pollClickedTabId()
    ) {
      if (!windowManager.showTab(tabId as TabId)) continue;
      activateWindow(windowManager.windowIdOfTab(tabId as TabId));
    }
  }, NOTIFICATION_CLICK_POLL_INTERVAL_MS);
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

/**
 * ウィンドウ1枚ぶんのRPC。BrowserViewごとにトランスポートが紐づくため、rpcはウィンドウごとに
 * 作り直す必要がある。tileId・tabId等を伴う操作はwindow-manager.tsが持ち主のウィンドウへ
 * 振り分けるのでwindowIdを見ないが、「今のウィンドウに対して」という意味の操作
 * （ポップアップ・ワークスペース新規作成・フォーカス移動）だけはこのwindowIdを起点にする
 */
function createWindowRpc(windowId: WindowId) {
  return BrowserView.defineRPC<NiwaRPC>({
    // ナビゲーション待ち等は数秒かかりうるため長めに設定。実際のタイムアウト制御はmainview側の
    // 内部タイムアウト（execBrowserJs/browserNavigateハンドラ）が先に発火し、必ずresolveで返す。
    // これは万一ハンドラがハングした場合の最終防波堤
    maxRequestTime: 20000,
    handlers: {
      requests: {
        listBoardLayouts: async ({ boardId }: { boardId: BoardId }) => ({
          layouts: await listResolvedLayouts(windowManager.getBoardFocusedCwd(boardId), layouts),
        }),
        selectionMenuItems: async ({ tabId, text }: { tabId: TabId; text: string }) => {
          const cwd = windowManager.getTabVar(tabId, "cwd");
          return {
            items: await selectionMenu.build({
              text,
              tabId,
              cwd: cwd.found ? cwd.value : undefined,
            }),
          };
        },
      },
      messages: {
        log: ({ msg }: { msg: string }) => {
          console.log(`[view] ${msg}`);
        },
        ready: () => {
          // webviewが読み込み直されると保持していたパレットも消えるため、差分判定を振り出しへ戻す
          views.get(windowId)?.lastPaletteCssByTabId.clear();
          scheduleRender(windowId);
          sendConfig(windowId);
          focusWebviewOnce(windowId);
        },
        input: ({ tabId, data }: { tabId: TabId; data: string }) => {
          windowManager.handleInput(tabId, data);
        },
        paste: ({ tabId, data }: { tabId: TabId; data: string }) => {
          windowManager.handlePaste(tabId, data);
        },
        mouseEvent: ({ tabId, event }: { tabId: TabId; event: MouseEventInput }) => {
          windowManager.handleMouseEvent(tabId, event);
        },
        enterCopyMode: ({ tabId }: { tabId: TabId }) => {
          windowManager.enterCopyMode(tabId);
        },
        copyModeKey: ({ tabId, key, ctrl }: { tabId: TabId; key: string; ctrl: boolean }) => {
          windowManager.handleCopyModeKey(tabId, { key, ctrl });
        },
        scroll: ({ tabId, deltaLines }: { tabId: TabId; deltaLines: number }) => {
          windowManager.handleScroll(tabId, deltaLines);
        },
        scrollToTop: ({ tabId }: { tabId: TabId }) => {
          windowManager.handleScrollToTop(tabId);
        },
        scrollToBottom: ({ tabId }: { tabId: TabId }) => {
          windowManager.handleScrollToBottom(tabId);
        },
        jumpPrompt: ({ tabId, direction }: { tabId: TabId; direction: "up" | "down" }) => {
          windowManager.handleJumpPrompt(tabId, direction);
        },
        copySelection: ({ text }: { text: string }) => {
          writeClipboardText(text);
        },
        pasteFromClipboard: ({ tabId }: { tabId: TabId }) => {
          readClipboardText().then((text) => {
            if (text) windowManager.handlePaste(tabId, text);
          });
        },
        openLink: ({ tabId, url, text }: { tabId: TabId; url: string; text: string }) => {
          handleOpenLink(tabId, url, text);
        },
        resize: (p: {
          tabId: TabId;
          cols: number;
          rows: number;
          cellWidth: number;
          cellHeight: number;
        }) => {
          windowManager.handleResize(p.tabId, p.cols, p.rows, p.cellWidth, p.cellHeight);
        },
        splitTile: ({ tileId, orientation }: { tileId: TileId; orientation: SplitOrientation }) => {
          windowManager.splitTile(tileId, orientation);
        },
        newTab: ({
          tileId,
          shellProfileId,
          cwd,
        }: {
          tileId: TileId;
          shellProfileId?: string;
          cwd?: string;
        }) => {
          const resolved = resolveShellProfileCommand(shellProfiles, shellProfileId);
          if (!resolved.ok) {
            console.log(`[bun] ${resolved.error}`);
            return;
          }
          windowManager.newTab(tileId, resolved.command, cwd);
        },
        newBrowserTab: ({ tileId, url }: { tileId: TileId; url?: string }) => {
          windowManager.newBrowserTab(tileId, url ?? browser.defaultUrl);
        },
        newCustomViewTab: ({ tileId, viewId }: { tileId: TileId; viewId?: string }) => {
          const view = findCustomView(viewId);
          if (!view) {
            console.log(
              `[bun] customView not found; ignoring newCustomViewTab (viewId: ${viewId ?? "(first)"})`,
            );
            return;
          }
          windowManager.newBrowserTab(tileId, view.url);
        },
        openPopup: () => {
          windowManager.openPopup(undefined, windowId);
        },
        closePopup: () => {
          windowManager.closePopup(windowId);
        },
        togglePopupVisibility: () => {
          windowManager.togglePopupVisibility(windowId);
        },
        promotePopup: () => {
          windowManager.promotePopup(windowId);
        },
        zoomFontSize: ({ delta }: { delta: number }) => {
          adjustFontSize(delta);
        },
        resetFontSizeZoom: () => {
          resetFontSizeZoom();
        },
        switchTab: ({ tileId, tabId }: { tileId: TileId; tabId: TabId }) => {
          windowManager.switchTab(tileId, tabId);
        },
        moveTab: ({
          fromTileId,
          tabId,
          toTileId,
        }: {
          fromTileId: TileId;
          tabId: TabId;
          toTileId: TileId;
        }) => {
          windowManager.moveTab(fromTileId, tabId, toTileId);
        },
        moveTabToSplit: ({
          fromTileId,
          tabId,
          targetTileId,
          orientation,
          placement,
        }: {
          fromTileId: TileId;
          tabId: TabId;
          targetTileId: TileId;
          orientation: SplitOrientation;
          placement: SplitPlacement;
        }) => {
          windowManager.moveTabToSplit(fromTileId, tabId, targetTileId, orientation, placement);
        },
        closeTab: ({ tileId, tabId }: { tileId: TileId; tabId: TabId }) => {
          windowManager.closeTab(tileId, tabId);
        },
        restartTab: ({ tabId }: { tabId: TabId }) => {
          windowManager.respawnTab(tabId);
        },
        focusTile: ({ tileId }: { tileId: TileId }) => {
          windowManager.focusTile(tileId);
        },
        focusDirection: ({ direction }: { direction: "up" | "down" | "left" | "right" }) => {
          windowManager.focusDirection(direction, windowId);
        },
        toggleZoomTile: ({ tileId }: { tileId: TileId }) => {
          windowManager.toggleZoomTile(tileId);
        },
        resizeTileInDirection: ({ direction }: { direction: "up" | "down" | "left" | "right" }) => {
          const tileId = windowManager.getFocusedTileId(windowId);
          if (!tileId) return;
          windowManager.resizeTileInDirection(tileId, direction, DEFAULT_RESIZE_AMOUNT);
        },
        resizeSplit: ({ splitId, ratio }: { splitId: TileId; ratio: number }) => {
          windowManager.resizeSplit(splitId, ratio);
        },
        newWorkspace: () => {
          windowManager.newWorkspace(undefined, windowId);
        },
        newWindow: () => {
          windowManager.newWindow();
        },
        // 閉じる順序はCLIの`window close`（ipcWindowOps）と揃える。window-manager側を先に畳むと
        // 持ち主が消えていて最終状態・ウィンドウ枠を書き出せない
        closeWindow: () => {
          finalizeWindow(windowId, true);
          windowManager.closeWindow(windowId);
        },
        quitApp: () => {
          quitApp();
        },
        switchWorkspace: ({ workspaceId }: { workspaceId: WorkspaceId }) => {
          windowManager.switchWorkspace(workspaceId);
        },
        moveWorkspace: ({
          workspaceId,
          toIndex,
        }: {
          workspaceId: WorkspaceId;
          toIndex: number;
        }) => {
          windowManager.moveWorkspace(workspaceId, toIndex);
        },
        closeWorkspace: ({ workspaceId }: { workspaceId: WorkspaceId }) => {
          windowManager.closeWorkspace(workspaceId);
        },
        newBoard: ({ workspaceId, cwd }: { workspaceId: WorkspaceId; cwd?: string }) => {
          windowManager.newBoard(workspaceId, cwd);
        },
        switchBoard: ({ boardId }: { boardId: BoardId }) => {
          windowManager.switchBoard(boardId);
        },
        moveBoard: ({ boardId, toIndex }: { boardId: BoardId; toIndex: number }) => {
          windowManager.moveBoard(boardId, toIndex);
        },
        moveBoardToWorkspace: ({
          boardId,
          workspaceId,
          toIndex,
        }: {
          boardId: BoardId;
          workspaceId: WorkspaceId;
          toIndex?: number;
        }) => {
          windowManager.moveBoardToWorkspace(boardId, workspaceId, toIndex);
        },
        closeBoard: ({ boardId }: { boardId: BoardId }) => {
          windowManager.closeBoard(boardId);
        },
        renameTab: ({ tabId, name }: { tabId: TabId; name: string }) => {
          windowManager.setTabName(tabId, name);
        },
        renameTile: ({ tileId, name }: { tileId: TileId; name: string }) => {
          windowManager.setTileName(tileId, name);
        },
        renameWorkspace: ({ workspaceId, name }: { workspaceId: WorkspaceId; name: string }) => {
          windowManager.setWorkspaceName(workspaceId, name);
        },
        renameBoard: ({ boardId, name }: { boardId: BoardId; name: string }) => {
          windowManager.setBoardName(boardId, name);
        },
        setBoardPhase: ({ boardId, phase }: { boardId: BoardId; phase: string | null }) => {
          windowManager.setBoardPhase(boardId, phase);
        },
        setBoardWorktreePath: ({ boardId, path }: { boardId: BoardId; path: string | null }) => {
          // 入力欄の初期値はそのBoardのフォーカス中タブのcwdなので、相対パスもそのタブ起点で解決する
          const resolved =
            path === null
              ? null
              : resolveWorktreeInputPath(
                  path,
                  windowManager.getBoardFocusedCwd(boardId),
                  windowManager.getBoardFocusedShell(boardId),
                );
          windowManager.setBoardWorktreePath(boardId, resolved);
        },
        applyBoardLayout: ({
          boardId,
          preset,
          trust,
        }: {
          boardId: BoardId;
          preset: string;
          trust?: boolean;
        }) => {
          // 解決起点はそのBoardのフォーカス中タブのcwd。そのタブで`niwaterm layout apply`を
          // 叩いたのと同じ解決になり、プロジェクトローカルのプリセットも同じ顔ぶれで引ける
          const cwd = windowManager.getBoardFocusedCwd(boardId);
          applyAndBindStartupLayout(windowManager, shellProfiles, layouts, {
            boardId,
            preset,
            ...(cwd !== undefined ? { cwd } : {}),
            ...(trust !== undefined ? { trust } : {}),
          })
            .then((result) => {
              if (result.ok) return;
              console.log(`[bun] applyBoardLayout failed: ${result.error}`);
              sendNotification({ title: "レイアウトを適用できません", body: result.error });
            })
            .catch((err: unknown) => {
              console.log(`[bun] applyBoardLayout error: ${String(err)}`);
            });
        },
        clearBoardStartup: ({ boardId }: { boardId: BoardId }) => {
          windowManager.setBoardStartup(boardId, null);
        },
        windowFocusChanged: ({ focused }: { focused: boolean }) => {
          const view = views.get(windowId);
          if (view) view.focused = focused;
          if (!focused) return;
          // id省略の操作（CLIの`workspace new`等）の対象は、最後にフォーカスされたウィンドウにする
          windowManager.setFocusedWindow(windowId);
          // フォーカスが戻った時点で見えているタブのベルを既読にするため、描画をやり直す
          scheduleRender(windowId);
        },
        runKeybindHandler: ({ handlerId }: { handlerId: string }) => {
          runKeybindHandler(handlerId).catch((err: unknown) => {
            console.log(`[bun] keybind handler error: ${String(err)}`);
          });
        },
        runSelectionMenuItem: ({ id }: { id: string }) => {
          void selectionMenu.run(id);
        },
        customViewCall: ({
          callId,
          viewId,
          name,
          payload,
        }: {
          callId: string;
          viewId: string;
          name: string;
          payload: unknown;
        }) => {
          void customViewHandlers
            .run(viewId, name, payload)
            .then((result) => sendCustomViewCallResult(callId, result));
        },
        reloadConfig: () => {
          handleConfigFileChanged().catch((err: unknown) => {
            console.log(`[bun] manual config reload error: ${String(err)}`);
          });
        },
      },
    },
  });
}

/** そのタブが載っているウィンドウのwebviewへブラウザタブ操作を投げるためのrpc */
function browserRpcOfTab(tabId: TabId) {
  const windowId = windowManager.windowIdOfTab(tabId);
  const rpc = windowId !== null ? (views.get(windowId)?.browserWindow.webview.rpc as any) : null;
  if (rpc) return rpc;
  // ウィンドウが閉じた直後のCLI操作等。エラーとして返せばCLI側が理由を表示できる
  const unavailable = async () => ({
    ok: false as const,
    error: `window not found for tab: ${tabId}`,
  });
  return { request: { browserNavigate: unavailable, execBrowserJs: unavailable } };
}

interface DisplayInfo {
  workArea: ScreenArea;
  isPrimary: boolean;
}

/** プライマリを先頭にした各ディスプレイの作業領域。取得できない環境では空配列 */
function screenWorkAreas(): ScreenArea[] {
  try {
    const displays = Screen.getAllDisplays() as DisplayInfo[];
    return displays
      .slice()
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map((display) => display.workArea)
      .filter((area) => area.width >= 1 && area.height >= 1);
  } catch (err: unknown) {
    console.log(`[bun] failed to query displays: ${String(err)}`);
    return [];
  }
}

// 透過の有無・タイトルバーの有無はどちらもウィンドウ生成時にしか決められない
// （Electrobunに実行時の切り替えAPIが無い）。設定を変えたときは再起動が必要
const isBackgroundTransparent = appearance.backgroundOpacity < 1;
const isTitleBarHidden = appearance.titleBar === "hidden";

/** 一時ウィンドウを重ねて開くときのずらし幅（px）。真下に重なって見失うのを防ぐ */
const WINDOW_CASCADE_OFFSET = 28;

/** 一時ウィンドウの枠。既定の枠を、今開いているウィンドウの枚数ぶんだけずらす */
function frameForNewWindow(): WindowFrame {
  const base = defaultWindowFrame(screenWorkAreas());
  const offset = WINDOW_CASCADE_OFFSET * views.size;
  return { ...base, x: base.x + offset, y: base.y + offset };
}

/**
 * 保存する値はネイティブ側の外枠（getFrame）から取り直す。move/resizeイベントが持つ
 * width/heightはwebview（クライアント領域）のサイズで、ウィンドウ生成時に渡す外枠より
 * タイトルバー・枠の分だけ小さいため、イベント値をそのまま保存すると起動のたびに縮んでいく。
 * 最小化中など復元に使えない値のときは、直前に控えた値を残す
 */
function captureWindowFrame(view: WindowView) {
  let frame: WindowFrame;
  try {
    frame = view.browserWindow.getFrame();
  } catch (err: unknown) {
    console.log(`[bun] failed to read window frame: ${String(err)}`);
    return;
  }
  const rounded: WindowFrame = {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.round(frame.width),
    height: Math.round(frame.height),
  };
  if (!isFrameRestorable(rounded, screenWorkAreas())) return;
  view.frame = rounded;
}

function saveWindowFrameNow(view: WindowView) {
  // 復元するのはメインウィンドウだけなので、一時ウィンドウの枠は保存しない
  if (!windowManager.isPersistent(view.windowId)) return;
  captureWindowFrame(view);
  try {
    saveWindowState(windowFramePath, view.frame);
  } catch (err: unknown) {
    console.log(`[bun] failed to save window frame: ${String(err)}`);
  }
}

// ウィンドウ枠の保存は500msでコアレスする（ドラッグ中はmove/resizeが連続で飛んでくる）
function scheduleWindowFrameSave(view: WindowView) {
  if (view.frameSaveScheduled) return;
  view.frameSaveScheduled = true;
  setTimeout(() => {
    view.frameSaveScheduled = false;
    if (!view.closed) saveWindowFrameNow(view);
  }, 500);
}

/**
 * ウィンドウが閉じたときの後始末。OSのクローズボタン（will-close/close）と、
 * 最後のタブが終了してwindow-manager側から畳まれた場合の両方から呼ばれるため冪等にする。
 * closeNativeはBrowserWindowをこちらから閉じる必要があるか（OS由来なら既に閉じている）
 */
function finalizeWindow(windowId: WindowId, closeNative: boolean): void {
  const view = views.get(windowId);
  if (!view || view.closed) return;
  view.closed = true;
  views.delete(windowId);
  // window-manager側から畳まれた場合、この時点で既にpersistent判定はfalseになっており
  // 中身も空なので保存は走らない（空のワークスペースで上書きしないための順序）
  saveWindowFrameNow(view);
  if (windowManager.isPersistent(windowId)) savePersistedStateNow();
  if (closeNative) view.browserWindow.close();
}

/** CLIの`tab show`等からウィンドウを前面に出す。windowId省略時はフォーカス中ウィンドウ */
function activateWindow(windowId?: WindowId | null): void {
  const view = views.get(windowId ?? windowManager.getFocusedWindowId());
  view?.browserWindow.activate();
}

/** 起動直後に一度だけ、webviewの中身へOSキーボードフォーカスを渡す（readyは再送されうるので1回だけ） */
function focusWebviewOnce(windowId: WindowId): void {
  const view = views.get(windowId);
  if (!view || view.webviewFocused) return;
  view.webviewFocused = true;
  // WindowsではactivateWindow（ネイティブのactivateWindow）がwebviewのOSキーボードフォーカスを
  // 壊し、物理クリックまでキー入力が一切届かなくなる（docs/known-issues/windows-popup-activatewindow-focus-loss.md）。
  // 加えてウィンドウ生成時点ではWebView2のコントローラがまだ無く、生成時のactivateではweb contentへ
  // フォーカスが渡らない。showWindow(activate:true)ならネイティブ側がFocusActiveView()＝
  // MoveFocus(PROGRAMMATIC)まで行うため、webviewの準備ができたready受信時に一度だけ呼ぶ
  if (process.platform !== "win32") return;
  view.browserWindow.show();
}

function createWindowView(windowId: WindowId, frame: WindowFrame): WindowView {
  const browserWindow = new BrowserWindow({
    // 開発中ビルド(niwaterm-wip-dev)と普段遣いビルド(niwaterm-daily-dev)を同時に起動した際に
    // タイトルバーで見分けられるよう、実際のアプリ名をそのまま使う
    title: APP_VARIANT,
    url: "views://mainview/index.html",
    frame: {
      width: frame.width,
      height: frame.height,
      x: frame.x,
      y: frame.y,
    },
    // 透過ウィンドウはWebView2の背景色を透明にする副作用も持つため、実際に透かすときだけ有効にする。
    // 不透明度そのものはwebview側のCSSで決まる（WebView2のDefaultBackgroundColorは
    // アルファ0か255しか受け付けず、半透明を表現できない）
    transparent: isBackgroundTransparent,
    // "hidden"ではなく"hiddenInset"を使う。Windowsの"hidden"はWS_POPUPになってネイティブ枠ごと
    // 失われ、角丸・リサイズ・スナップが効かなくなる。"hiddenInset"はWS_CAPTION|WS_THICKFRAMEの
    // ままWM_NCCALCSIZEでキャプション領域だけ削るので枠の挙動が残る。
    // macOSではウィンドウ操作ボタンがコンテンツへ重なって残る
    titleBarStyle: isTitleBarHidden ? "hiddenInset" : "default",
    rpc: createWindowRpc(windowId),
  });

  if (isBackgroundTransparent) {
    // Electrobunが立てるWS_EX_LAYEREDのままだとネイティブ枠が描画されないため、
    // 生成後にDWM側の透過へ切り替える（詳細: src/native/winwindow.c）。
    // 未処理のウィンドウだけが対象なので、ウィンドウを開くたびに呼んでよい
    enableWindowTransparency();
  }

  const view: WindowView = {
    windowId,
    browserWindow,
    focused: true,
    webviewFocused: false,
    renderScheduled: false,
    lastPaletteCssByTabId: new Map(),
    frame,
    frameSaveScheduled: false,
    closed: false,
  };
  views.set(windowId, view);

  browserWindow.on("move", () => scheduleWindowFrameSave(view));
  browserWindow.on("resize", () => scheduleWindowFrameSave(view));

  // Electrobunはアプリコードをbun Worker上で実行するため、Worker側で登録したprocess.on("exit")や
  // シグナルハンドラはアプリ終了時に発火しない（Electrobunがprocess.exitを上書きし、ネイティブ側の
  // quitGracefullyでプロセスを終わらせるため）。このためウィンドウを閉じただけではcleanup()＝
  // 全セッションのdispose()もIPCサーバーの停止も一度も走らず、Windows実機ではbridge-port・
  // niwaterm.sockが残留する（PTYの子プロセス自体はアプリのプロセス終了に伴いOSが回収するが、
  // killをOS任せにせず明示的に落とす）。そこでElectrobunのウィンドウ終了イベントから
  // そのウィンドウを畳み、最後の1枚が閉じた時点でcleanup()＋終了する。
  // will-closeはウィンドウを閉じる直前（ネイティブのcloseWindowより前）に発火する
  const onNativeClose = () => {
    finalizeWindow(windowId, false);
    windowManager.closeWindow(windowId);
  };
  browserWindow.on("will-close", onNativeClose);
  browserWindow.on("close", onNativeClose);

  // Windowsでのactivateはwebviewのキーボードフォーカスを壊すため、ここでは呼ばない
  // （focusWebviewOnceでready受信時にshowする）
  if (process.platform !== "win32") {
    browserWindow.activate();
  }

  return view;
}

// メインウィンドウだけは前回のサイズ・位置を復元する
createWindowView(
  windowManager.mainWindowId,
  resolveWindowFrame(loadWindowState(windowFramePath), screenWorkAreas()),
);

// Cmd+Q等のアプリ終了要求。ウィンドウのcloseイベントが来ないまま終わる経路のため、
// ここでもメインウィンドウの状態を書き出してから後始末する
Electrobun.events.on("before-quit", () => {
  for (const view of views.values()) {
    saveWindowFrameNow(view);
  }
  savePersistedStateNow();
  cleanup();
});

const configWatcher = watchConfigFile(configFilePath(), () => {
  void handleConfigFileChanged();
});

console.log("niwaterm started");
