import "./index.css";
import Electrobun, { Electroview, type WebviewTagElement } from "electrobun/view";
import {
  compileKeybindings,
  defaultAppearance,
  defaultKeybindings,
  type KeybindingsConfig,
  type ResolvedAppearanceConfig,
  type ResolvedCustomViewConfig,
  type ShellProfile,
} from "@niwaterm/config";
import { createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { NiwaRPC } from "../bun/index";
import type { CursorShape, MouseAction, MouseButton } from "../bun/ghostty";
import type { CopyModeRenderState } from "../bun/terminal-session";
import type { LayoutListEntry } from "../bun/project-config";
import type { TabRenderState } from "../bun/workspace";
import { findNode, nextTabId, type TabId, type TileId, type TileNode } from "../bun/tile-layout";
import type {
  AppRenderState,
  BoardId,
  WorkspaceId,
  WorkspaceListEntry,
} from "../bun/workspace-manager";
import { buildExecBrowserJsScript } from "./browser-js-bridge";
import { keyToBytes } from "./key-to-bytes";
import { domMouseButton, mouseModsFromEvent, wheelReport } from "./mouse";
import { normalizeUrl } from "./normalize-url";
import { BrowserToolbar } from "./react/browser-toolbar";
import { CommandPalette, type NonPaletteKeybindAction } from "./react/command-palette";
import { ConfirmDialog } from "./react/confirm-dialog";
import { PopupToolbar } from "./react/popup-toolbar";
import { PromptDialog } from "./react/prompt-dialog";
import { SidebarToolbar } from "./react/sidebar-toolbar";
import { boardLabel, buildSidebarWorkspaceItems } from "./react/sidebar-props";
import { SidebarSwitcher } from "./react/sidebar-switcher";
import {
  SidebarWorkspaceList,
  type SidebarApplyLayoutRequest,
} from "./react/sidebar-workspace-list";
import { TAB_DRAG_MIME, TileTabBar, type TabDragPayload } from "./react/tile-tab-bar";
import { actionToTileCommand, createKeybindResolver, type TileCommand } from "./tile-keybindings";
import {
  type CellGlyphTransform,
  computeCellGlyphTransform,
  identityCellGlyphTransform,
  isCellGlyphChar,
  isIdentityCellGlyphTransform,
  measureInkExtent,
} from "./cell-glyph";
import { isWideChar } from "../shared/wide-char";

const screenEl = document.getElementById("screen") as HTMLDivElement;
const tileTreeEl = document.getElementById("tile-tree") as HTMLDivElement;
const measureEl = document.getElementById("measure") as HTMLSpanElement;
const imeEl = document.getElementById("ime-input") as HTMLTextAreaElement;
const compositionEl = document.getElementById("composition") as HTMLDivElement;
const tileTemplate = document.getElementById("tile-template") as HTMLTemplateElement;
const tabContentTemplate = document.getElementById("tab-content-template") as HTMLTemplateElement;
const sidebarEl = document.getElementById("sidebar") as HTMLElement;
const sidebarDividerEl = document.getElementById("sidebar-divider") as HTMLDivElement;
const sidebarListEl = document.getElementById("sidebar-list") as HTMLDivElement;
const sidebarSwitcherEl = document.getElementById("sidebar-switcher") as HTMLDivElement;
const sidebarCustomViewEl = document.getElementById("sidebar-custom-view") as HTMLDivElement;
const popupEl = document.getElementById("popup") as HTMLDivElement;
const popupBoxEl = document.getElementById("popup-box") as HTMLDivElement;
const popupTermEl = popupBoxEl.querySelector(".term") as HTMLDivElement;
const popupCursorEl = popupBoxEl.querySelector(".cursor") as HTMLDivElement;
const popupCopyOverlayEl = popupBoxEl.querySelector(".copy-overlay") as HTMLDivElement;
const popupToolbarEl = popupBoxEl.querySelector("#popup-toolbar") as HTMLDivElement;
const sidebarToolbarEl = document.getElementById("sidebar-toolbar") as HTMLDivElement;
const commandPaletteRootEl = document.getElementById("command-palette-root") as HTMLDivElement;
const confirmDialogRootEl = document.getElementById("confirm-dialog-root") as HTMLDivElement;
const promptDialogRootEl = document.getElementById("prompt-dialog-root") as HTMLDivElement;

// ---- タイル/タブごとのDOM要素・状態管理 ----
const tileElByTileId = new Map<TileId, HTMLElement>();
const tabBarElByTileId = new Map<TileId, HTMLDivElement>();
const tabBarReactRootByTileId = new Map<TileId, MemoRoot>();
// shellProfilesは設定リロードのたびに配列ごと作り直されるため、参照比較の代わりに世代番号で見る
let shellProfilesVersion = 0;
const tabContentElByTabId = new Map<TabId, HTMLDivElement>();
const termElByTabId = new Map<TabId, HTMLDivElement>();
const cursorElByTabId = new Map<TabId, HTMLDivElement>();
const copyOverlayElByTabId = new Map<TabId, HTMLDivElement>();
/** コピーモード中のタブ（キー入力をPTYではなくbunのコピーモードへ回すかの判定に使う） */
const copyModeTabIds = new Set<TabId>();
/** コピーモードの検索文字列を入力中のタブ（IME確定・ペーストを検索文字列へ回すかの判定に使う） */
const copyModeSearchTabIds = new Set<TabId>();
const browserElByTabId = new Map<TabId, WebviewTagElement>();
const browserToolbarRootByTabId = new Map<TabId, MemoRoot>();
// webviewId確定・初回dom-ready発火済みか（execBrowserJs/browserNavigateの前提条件判定に使う）
const browserDomReadyByTabId = new Map<TabId, boolean>();
// execBrowserJsの結果待ちPromiseの相関ID管理。host-message受信 or タイムアウトで解決・削除する
const execJsPendingByRequestId = new Map<
  string,
  { resolve: (r: { ok: true; result: unknown } | { ok: false; error: string }) => void }
>();
let execJsRequestSeq = 0;
/** tabId単位でpendingを絞り込めるよう、requestIdの先頭にtabIdを埋め込む（gcStale時の一括解決用） */
function execJsRequestIdPrefix(tabId: TabId): string {
  return `bjs-${tabId}-`;
}
const EXEC_JS_TIMEOUT_MS = 8000;
const NAVIGATE_LOAD_TIMEOUT_MS = 15000;
const resizeObserverByTabId = new Map<TabId, ResizeObserver>();
const activeTabByTile = new Map<TileId, TabId>();
/** タイル内の全タブ。背面タブへ実測サイズを配る（sendResize参照）ために保持する */
const tabIdsByTileId = new Map<TileId, TabId[]>();
/** 一度でもresizeを送ったタブ。bun側のPTY起動保留が解除済みかの判定に使う */
const resizeSentTabIds = new Set<TabId>();
const splitElBySplitId = new Map<TileId, HTMLDivElement>();
const dividerElBySplitId = new Map<TileId, HTMLDivElement>();

// ---- React root ----
/**
 * React rootの薄いラッパー。**このファイルでは生の`Root`を直接持たず、必ずこれを経由する。**
 *
 * 理由: `reconcile()`がタイルごとに毎フレーム`root.render()`を無条件で呼ぶと、rendererプロセスの
 * メモリがJSヒープ外（Blink側）へ約5MB/秒積み上がって解放されず、数時間でWebView2 rendererが
 * OOMクラッシュしてウィンドウが真っ白になる。DOMノード数もJSヒープも横ばいのまま増えるため、
 * JS側からは見えないリークになる。
 *
 * そこで`render(element)`という「いつでも呼べる入口」を無くし、呼び出し側に
 * どちらの性質のrenderなのかを選ばせる:
 * - `renderIfChanged` … renderメッセージのたびに呼ばれる箇所。propsのキーが変わった時だけrenderする
 * - `renderOnEvent` … 呼ばれる回数が入力量に比例しない箇所（初期化・ユーザー操作起点）
 *
 * さらに、`renderOnEvent`が将来ホットパスへ紛れ込んだ場合に気づけるよう、
 * 1秒あたりのrender回数が閾値を超えたら一度だけ警告する。
 */
type MemoRoot = {
  /** keyが前回と同じならrenderしない（elementの構築自体も行わない） */
  renderIfChanged(key: string, build: () => ReactElement): void;
  /** 入力量に比例して呼ばれない箇所のrender */
  renderOnEvent(element: ReactElement): void;
  unmount(): void;
};

/** これを超える頻度でrenderされたら、ホットパスからのrenderを疑って警告する（1秒あたり） */
const RENDER_CANARY_PER_SECOND = 30;

function createMemoRoot(container: Element, name: string): MemoRoot {
  const root = createRoot(container);
  let lastKey: string | null = null;
  let windowStartMs = 0;
  let countInWindow = 0;
  let warned = false;

  const commit = (element: ReactElement) => {
    const now = performance.now();
    if (now - windowStartMs >= 1000) {
      windowStartMs = now;
      countInWindow = 0;
    }
    countInWindow++;
    if (!warned && countInWindow > RENDER_CANARY_PER_SECOND) {
      warned = true;
      sendMessage("log", {
        msg:
          `[warn] React root "${name}" が1秒間に${countInWindow}回renderされた。` +
          `renderIfChangedのキーが毎回変わっていないか、renderOnEventがホットパスに居ないか確認する` +
          `（rendererプロセスのメモリリークの原因になる）`,
      });
    }
    root.render(element);
  };

  return {
    renderIfChanged(key, build) {
      if (lastKey === key) return;
      lastKey = key;
      commit(build());
    },
    renderOnEvent(element) {
      // 次のrenderIfChangedが同じkeyでも確実にrenderし直せるよう、キャッシュは捨てる
      lastKey = null;
      commit(element);
    },
    unmount() {
      root.unmount();
    },
  };
}

// ---- サイドバー: 起動時に固定のReact root（closeやopen等に応じて中身だけ差し替える）----
const sidebarSwitcherRoot = createMemoRoot(sidebarSwitcherEl, "sidebar-switcher");
const sidebarWorkspaceListRoot = createMemoRoot(sidebarListEl, "sidebar-workspace-list");

// ---- ポップアップツールバー: 起動時に固定のReact root（propsは不変のため一度だけrenderする）----
const popupToolbarRoot = createMemoRoot(popupToolbarEl, "popup-toolbar");
popupToolbarRoot.renderOnEvent(
  createElement(PopupToolbar, {
    onPromote: () => sendMessage("promotePopup"),
    onMinimize: () => sendMessage("togglePopupVisibility"),
    onClose: () => sendMessage("closePopup"),
  }),
);

// ---- サイドバーツールバー: 起動時に固定のReact root（propsは不変のため一度だけrenderする）----
const sidebarToolbarRoot = createMemoRoot(sidebarToolbarEl, "sidebar-toolbar");
sidebarToolbarRoot.renderOnEvent(
  createElement(SidebarToolbar, {
    onOpenCommandPalette: () => openCommandPalette(),
  }),
);

// ---- コマンドパレット: open状態が変わるたびrenderし直す ----
const commandPaletteRoot = createMemoRoot(commandPaletteRootEl, "command-palette");
let commandPaletteOpen = false;
// bun側からのkeybindingsメッセージ到達前はデフォルトキーバインドで表示する（keybindResolverと同様）
let lastKeybindingsConfig: KeybindingsConfig = defaultKeybindings;

function formatKeyToken(token: string): string {
  return token
    .split("+")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("+");
}

function shortcutLabelForAction(action: NonPaletteKeybindAction): string | undefined {
  const prefix = lastKeybindingsConfig.prefix;
  if (!prefix) return undefined;
  const entry = Object.entries(lastKeybindingsConfig.bindings ?? {}).find(
    ([, boundAction]) => boundAction === action,
  );
  if (!entry) return undefined;
  return `${formatKeyToken(prefix)} ${formatKeyToken(entry[0])}`;
}

function renderCommandPalette(): void {
  commandPaletteRoot.renderOnEvent(
    createElement(CommandPalette, {
      open: commandPaletteOpen,
      onOpenChange: (open: boolean) => {
        commandPaletteOpen = open;
        if (!open) imeEl.focus({ preventScroll: true });
        renderCommandPalette();
      },
      onSelectAction: (action: NonPaletteKeybindAction) => {
        handleTileCommand(actionToTileCommand(action));
      },
      shortcutLabelFor: shortcutLabelForAction,
    }),
  );
}

function openCommandPalette(): void {
  commandPaletteOpen = true;
  renderCommandPalette();
}

// ---- 確認ダイアログ: キーバインドから起動する破壊的操作向け（y/n・Escでキーボード操作完結）----
const confirmDialogRoot = createMemoRoot(confirmDialogRootEl, "confirm-dialog");
let confirmDialogOpen = false;
let confirmDialogTitle = "";
let confirmDialogDescription: string | undefined;
let confirmDialogOnConfirm: (() => void) | null = null;

function renderConfirmDialog(): void {
  confirmDialogRoot.renderOnEvent(
    createElement(ConfirmDialog, {
      open: confirmDialogOpen,
      title: confirmDialogTitle,
      description: confirmDialogDescription,
      onConfirm: () => {
        const onConfirm = confirmDialogOnConfirm;
        closeConfirmDialog();
        onConfirm?.();
      },
      onCancel: () => closeConfirmDialog(),
    }),
  );
}

function closeConfirmDialog(): void {
  confirmDialogOpen = false;
  confirmDialogOnConfirm = null;
  renderConfirmDialog();
  imeEl.focus({ preventScroll: true });
}

function openConfirmDialog(
  title: string,
  description: string | undefined,
  onConfirm: () => void,
): void {
  confirmDialogTitle = title;
  confirmDialogDescription = description;
  confirmDialogOnConfirm = onConfirm;
  confirmDialogOpen = true;
  renderConfirmDialog();
}

// ---- 入力ダイアログ: 名前変更向け（サイドバーを開いていなくてもキーボードだけで完結できる）----
const promptDialogRoot = createMemoRoot(promptDialogRootEl, "prompt-dialog");
let promptDialogOpen = false;
let promptDialogTitle = "";
let promptDialogDescription: string | undefined;
let promptDialogInitialValue = "";
let promptDialogOnSubmit: ((value: string) => void) | null = null;

function renderPromptDialog(): void {
  promptDialogRoot.renderOnEvent(
    createElement(PromptDialog, {
      open: promptDialogOpen,
      title: promptDialogTitle,
      description: promptDialogDescription,
      initialValue: promptDialogInitialValue,
      onSubmit: (value: string) => {
        const onSubmit = promptDialogOnSubmit;
        closePromptDialog();
        onSubmit?.(value);
      },
      onCancel: () => closePromptDialog(),
    }),
  );
}

function closePromptDialog(): void {
  promptDialogOpen = false;
  promptDialogOnSubmit = null;
  renderPromptDialog();
  imeEl.focus({ preventScroll: true });
}

function openPromptDialog(
  title: string,
  description: string | undefined,
  initialValue: string,
  onSubmit: (value: string) => void,
): void {
  promptDialogTitle = title;
  promptDialogDescription = description;
  promptDialogInitialValue = initialValue;
  promptDialogOnSubmit = onSubmit;
  promptDialogOpen = true;
  renderPromptDialog();
}

// ---- サイドバーのユーザー定義HTML UI（customView）----
let customViewWebviewEl: WebviewTagElement | null = null;
let customViewUrl: string | null = null;
let customViewName: string | null = null;
let sidebarShowingCustom = false;

let focusedTileId: TileId | null = null;
// フォーカス中タイルのactiveTabId（キー入力・ペーストの送信先）
let currentTabId: TabId | null = null;
// 一時的にズーム表示中のtileId（tmuxのresize-pane -Z相当）。bun側が真実の情報源で、render()経由でのみ更新する
let zoomedTileId: TileId | null = null;
// 直近のrender()で受け取ったlayout。cycleTab等、キー操作時にDOM待ちせず参照するために保持する
let lastLayout: TileNode | null = null;
// 直近のrender()で受け取ったアクティブワークスペースのタブ名。タブバーのラベル表示に使う
let lastTabNames: Record<TabId, string> = {};
// ワークスペース切替（Cmd+Option+]/[）の次/前の対象を解決するために保持する
let activeWorkspaceId: WorkspaceId | null = null;
let workspaceIds: WorkspaceId[] = [];
// Board切替（next-board/prev-board）の次/前の対象を解決するために保持する。
// アクティブワークスペース分のみ（render()はアクティブワークスペースのBoard群しか送らない）
let activeBoardId: BoardId | null = null;
let boardIds: BoardId[] = [];
// ポップアップ（タイルに所属しない一時的な画面。ADR 0005）の現在のtabId・表示状態
let currentPopupTabId: TabId | null = null;
let popupVisible = false;
let popupResizeObserver: ResizeObserver | null = null;
// ドラッグ中のsplitId。reconcile時にflexスタイルを上書きしないようにするためのガード
let draggingSplitId: TileId | null = null;
// ドラッグ確定直後、bun側のtreeがまだ古いratioのままのrenderが届く可能性があるため、
// bunのratioが確定値に追いつくまでローカルのratioを維持する（それまでの間、古いratioで
// flexスタイルが巻き戻されてResizeObserverが誤ったcolsを送ってしまうのを防ぐ）
let pendingSplitRatio: { splitId: TileId; ratio: number } | null = null;
// bun側からのkeybindingsメッセージ到達前はデフォルトキーバインドにフォールバックする。
// プラットフォーム別デフォルト（direct: Windowsのみコピー・ペーストを直接ショートカット化）の
// 解決はbun側が行うため、ここではmacOS向けの値になる。configメッセージ到達時に正しいテーブルへ差し替わる
let keybindResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
// 直近のrender()で受け取った全ワークスペースの一覧。サイドバーを開いた瞬間に再描画するため保持する
let lastWorkspaces: WorkspaceListEntry[] = [];
// bun側で解決されたシェルプロファイル一覧（configメッセージで受信）。+ボタン横のドロップダウンに表示する
let shellProfiles: ShellProfile[] = [];

const SIDEBAR_OPEN_STORAGE_KEY = "niwaterm:sidebarOpen";

function loadSidebarOpen(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

function saveSidebarOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // 保存できなくても致命的ではない（次回起動時はデフォルト「開」にフォールバックする）
  }
}

let sidebarOpen = loadSidebarOpen();

const SIDEBAR_WIDTH_STORAGE_KEY = "niwaterm:sidebarWidth";
const DEFAULT_SIDEBAR_WIDTH_PX = 200;
const MIN_SIDEBAR_WIDTH_PX = 150;
const MAX_SIDEBAR_WIDTH_RATIO = 0.5;

function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const width = stored === null ? Number.NaN : Number.parseFloat(stored);
    return Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH_PX;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH_PX;
  }
}

function saveSidebarWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, `${width}`);
  } catch {
    // 保存できなくても致命的ではない（次回起動時はデフォルト幅にフォールバックする）
  }
}

let sidebarWidth = loadSidebarWidth();
// サイドバーdivider用のドラッグ中フラグ（タイル分割のdraggingSplitIdと同様、
// ResizeObserver経由のresize送信を抑制するために使う）
let draggingSidebar = false;

function applySidebarWidth(width: number): void {
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
}

// ---- 256色パレットのCSS変数を定義する（formatter出力が var(--vt-palette-N) を参照する）----
// ANSI 0-15（標準色）は外観設定で変更可能なため、外観変更のたびに呼ばれるapplyAnsiPaletteに分離する。
// 16-231(6x6x6キューブ)/232-255(グレースケール)は固定計算式でユーザー設定に依存しないため起動時1回でよい。
function applyAnsiPalette(colors: readonly string[]) {
  const root = document.documentElement.style;
  for (let i = 0; i < 16; i++) {
    root.setProperty(`--vt-palette-${i}`, colors[i] ?? "#ffffff");
  }
}

function setupPalette() {
  const root = document.documentElement.style;
  // 16-231: 6x6x6 カラーキューブ
  const steps = [0, 95, 135, 175, 215, 255];
  for (let i = 16; i < 232; i++) {
    const n = i - 16;
    const r = steps[Math.floor(n / 36)];
    const g = steps[Math.floor(n / 6) % 6];
    const b = steps[n % 6];
    root.setProperty(`--vt-palette-${i}`, `rgb(${r} ${g} ${b})`);
  }
  // 232-255: グレースケール
  for (let i = 232; i < 256; i++) {
    const v = 8 + (i - 232) * 10;
    root.setProperty(`--vt-palette-${i}`, `rgb(${v} ${v} ${v})`);
  }
}

// ---- 外観設定（フォント・カラーテーマ）の適用 ----
function applyAppearance(config: ResolvedAppearanceConfig) {
  const root = document.documentElement.style;
  root.setProperty("--term-font", config.fontFamily);
  root.setProperty("--term-font-size", `${config.fontSize}px`);
  root.setProperty("--term-line-height", `${config.lineHeight}px`);
  root.setProperty("--term-fg", config.foreground);
  root.setProperty("--term-bg", config.background);
  applyAnsiPalette(config.ansiColors);
  // 罫線・ブロック文字を行の高さへ合わせる変換はフォント・サイズ・行高に依存するため測り直す
  updateCellGlyphTransform();
  // フォントサイズ変更でcellWidth/cellHeightが変わりうるため、表示中の全タブへ再計測・再送する
  for (const tabId of activeTabByTile.values()) {
    sendResize(tabId);
  }
}

// ---- RPC ----

// bunからの最初の応答(config/render)を受け取ったか。Electrobunのwebview→bun RPCソケットが
// 別インスタンスへ誤接続していないかの判定に使う（このファイル末尾の起動処理を参照）
let hostRpcReplyReceived = false;

const rpc = Electroview.defineRPC<NiwaRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {
      browserNavigate: ({ tabId, url }: { tabId: TabId; url: string }) =>
        browserNavigate(tabId, url),
      execBrowserJs: ({ tabId, code }: { tabId: TabId; code: string }) =>
        execBrowserJs(tabId, code),
    },
    messages: {
      render: (p: AppRenderState) => {
        hostRpcReplyReceived = true;
        activeWorkspaceId = p.activeWorkspaceId;
        workspaceIds = p.workspaceIds;
        activeBoardId = p.workspace.activeBoardId;
        boardIds = p.workspace.boardIds;
        const activeBoard = p.workspace.board;
        lastLayout = activeBoard.layout;
        lastTabNames = activeBoard.tabNames;
        // reconcile()がzoomedTileIdをモジュールスコープ変数から直接参照するため、
        // renderLayout()より前に確定させる必要がある（後回しにすると常に1render分古い
        // ズーム状態でreconcileしてしまい、ズーム切り替えの反映が一拍遅れて見た目が壊れる）
        zoomedTileId = activeBoard.zoomedTileId;
        // 昇格（promote）時、popupだったtabIdがここで通常タブとしてDOM登録される。
        // 後続のapplyPopupStateのteardownPopupContentはこの登録が既に上書き済みか判定して
        // 動くため、renderLayout→applyPopupStateの順序は変更しないこと
        renderLayout(activeBoard.layout, activeBoard.tabs);
        lastWorkspaces = p.workspaces;
        if (sidebarOpen) renderSidebar(lastWorkspaces, activeWorkspaceId);
        focusedTileId = activeBoard.focusedTileId;
        applyPopupState(p.workspace.popup);
        // ポップアップ表示中はキー入力・ペーストの送信先をポップアップへ向ける
        currentTabId =
          popupVisible && currentPopupTabId
            ? currentPopupTabId
            : ((focusedTileId && activeTabByTile.get(focusedTileId)) ?? null);
        updateFocusHighlight();
        for (const tabId of Object.keys(activeBoard.tabs)) {
          const renderState = activeBoard.tabs[tabId];
          if (!renderState || renderState.kind !== "terminal") continue;
          const termEl = termElByTabId.get(tabId);
          if (!termEl) continue;
          termEl.innerHTML = renderState.html;
          fixGlyphs(termEl);
          // スクロールバック閲覧中はhtmlがその位置の内容になり、cursorX/Yは
          // アクティブエリア（最新行）側の座標のまま非表示にする（対応する画面外のため）。
          // 加えて、フォーカスしていないタイルのタブではカーソルを表示しない（tmux同様の挙動）
          // コピーモード中は専用カーソル（オーバーレイ）だけを見せる
          updateCursorForTab(
            tabId,
            renderState.cursorX,
            renderState.cursorY,
            renderState.cursorVisible &&
              renderState.viewportPinned &&
              tabId === currentTabId &&
              renderState.copyMode === null,
            renderState.cursorShape,
          );
          updateCopyModeForTab(tabId, renderState.copyMode);
          mouseTrackingByTabId.set(tabId, {
            tracking: renderState.mouseTracking,
            anyMotion: renderState.mouseAnyMotion,
          });
          updateScrollIndicator(tabId, renderState.viewportPinned || renderState.copyMode !== null);
          if (tabId === currentTabId && renderState.viewportPinned) {
            updateImePosition(renderState.cursorX, renderState.cursorY);
          }
        }
      },
      config: ({
        keybindings,
        appearance,
        customView,
        shellProfiles: profiles,
      }: {
        keybindings: KeybindingsConfig;
        appearance: ResolvedAppearanceConfig;
        customView: ResolvedCustomViewConfig | null;
        shellProfiles: ShellProfile[];
      }) => {
        hostRpcReplyReceived = true;
        keybindResolver = createKeybindResolver(compileKeybindings(keybindings));
        lastKeybindingsConfig = keybindings;
        applyAppearance(appearance);
        applyCustomView(customView);
        shellProfiles = profiles;
        shellProfilesVersion++;
        // configの到達タイミングは既存タイルの最終renderより後になりうるため、
        // ドロップダウンの中身（shellProfiles）を最新化するために明示的に再renderする
        for (const tileId of tabBarReactRootByTileId.keys()) renderTileTabBar(tileId);
        // ショートカット表示（prefix+2打目キー）を最新のkeybindingsで再renderする
        renderCommandPalette();
      },
    },
  },
});

const electroview = new Electrobun.Electroview({ rpc });

function sendMessage(name: string, payload?: unknown) {
  (rpc as any)?.send?.[name]?.(payload ?? {});
}

// ---- セル計測 ----
let cellWidth = 8;
let cellHeight = 18;

function measureCell() {
  const rect = measureEl.getBoundingClientRect();
  if (rect.width > 0) cellWidth = rect.width;
  if (rect.height > 0) cellHeight = rect.height;
  // .wide の幅計算（2セル幅）用にCSS変数へ反映する
  document.documentElement.style.setProperty("--cell-w", `${cellWidth}px`);
}

// ---- 罫線・ブロック文字のセル充填 ----
// フォントの█のインク矩形を行ボックス全体へ写す変換をCSS変数として持ち、
// .cell-glyph（fixGlyphsが付ける）へtransformで適用する。詳細はcell-glyph.ts参照
let cellGlyphTransform: CellGlyphTransform = identityCellGlyphTransform;
let cellGlyphMeasureCanvas: HTMLCanvasElement | null = null;

/**
 * 行ボックス上端からベースラインまでの距離を実測する。
 * 中身が空のinline-blockはベースラインが下マージン辺（＝高さ0なら自分の上端）になる
 * CSSの規定を使い、行ボックス上端からのオフセットとして読み取る。
 * フォントメトリクスから計算するより、実際のブラウザの行ボックス計算に一致する。
 */
function measureBaselineOffset(style: CSSStyleDeclaration): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:0;left:-9999px;visibility:hidden;white-space:pre;" +
    `font-family:${style.fontFamily};font-size:${style.fontSize};line-height:${style.lineHeight};`;
  const marker = document.createElement("span");
  marker.style.cssText = "display:inline-block;width:0;height:0;";
  probe.append(document.createTextNode("█"), marker);
  document.body.appendChild(probe);
  const baseline = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  return baseline;
}

/**
 * █を実際にラスタライズして、インク矩形（グリフが実際に描かれる範囲）をCSSピクセルで実測する。
 * measureTextのactualBoundingBoxではなく走査で測る理由はcell-glyph.tsのmeasureInkExtent参照。
 */
function measureCellGlyphInk(
  fontSize: number,
  fontFamily: string,
): { inkAscent: number; inkDescent: number } | null {
  const dpr = window.devicePixelRatio || 1;
  // インクはfont-sizeより大きくなりうるので余裕を持った画布に描く
  const width = Math.ceil(fontSize * 3);
  const height = Math.ceil(fontSize * 4);
  const baselineY = Math.round(height * 0.75);
  const canvas = (cellGlyphMeasureCanvas ??= document.createElement("canvas"));
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  // 同じフォント指定を渡せばフォールバックの解決結果も描画側と揃う
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillText("█", fontSize, baselineY);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return null;
  }
  // 黒地に白で描いたので、行内の最大輝度がその行のインク被覆率になる
  // （サブピクセルアンチエイリアスでチャンネルがばらつくため3チャンネルの平均で見る）
  const coverage: number[] = [];
  for (let y = 0; y < canvas.height; y++) {
    let max = 0;
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const v = ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
      if (v > max) max = v;
    }
    coverage.push(max / 255);
  }
  const ink = measureInkExtent(coverage, baselineY * dpr);
  if (!ink) return null;
  return { inkAscent: ink.inkAscent / dpr, inkDescent: ink.inkDescent / dpr };
}

/**
 * 行の高さを埋められる拡大率を、実際にラスタライズしながら探す。
 *
 * 理論値（行の高さ ÷ 等倍のインク高）で決め打ちできないのは、Windows(Chromium/DirectWrite)が
 * グリフのラスタライズ解像度(ppem)を整数へ丸めるため。font-size 13pxに1.03倍をかけても
 * ppemは13のままで、グリフの大きさが変わらず隙間が残る。
 * canvasのラスタライズもDOMと同じ丸めをするので、実測しながら上げていけば丸めの有無に
 * 関わらず「行の高さを埋められる最小の倍率」へ収束する。
 *
 * @returns 採用する倍率と、その倍率で実際に描かれるインクの上下端。埋められないならnull
 */
function findCellGlyphFill(
  fontSize: number,
  fontFamily: string,
  lineHeight: number,
): { scaleY: number; inkAscent: number; inkDescent: number } | null {
  const base = measureCellGlyphInk(fontSize, fontFamily);
  if (!base) return null;
  const baseHeight = base.inkAscent + base.inkDescent;
  if (!(baseHeight > 0)) return null;
  // 等倍で既に行の高さ以上なら拡大しない（縮小するとppemの丸めで逆に足りなくなりうる）
  if (baseHeight >= lineHeight) return { scaleY: 1, ...base };
  // 理論値から始め、足りなければフォントサイズを少しずつ上げて実測し直す
  const step = 0.25;
  const maxSize = fontSize * 2;
  for (let size = fontSize * (lineHeight / baseHeight); size <= maxSize; size += step) {
    const ink = measureCellGlyphInk(size, fontFamily);
    if (!ink) return null;
    if (ink.inkAscent + ink.inkDescent >= lineHeight) {
      return { scaleY: size / fontSize, inkAscent: ink.inkAscent, inkDescent: ink.inkDescent };
    }
  }
  return null;
}

/** フォント・フォントサイズ・行の高さが変わったときに変換を測り直す */
function updateCellGlyphTransform() {
  const style = getComputedStyle(measureEl);
  const fontSize = Number.parseFloat(style.fontSize);
  const lineHeight = Number.parseFloat(style.lineHeight);
  cellGlyphTransform = identityCellGlyphTransform;
  if (Number.isFinite(fontSize) && Number.isFinite(lineHeight)) {
    // インク矩形（グリフの実際の描画範囲）はDOMからは取れないのでcanvasで測る
    const fill = findCellGlyphFill(fontSize, style.fontFamily, lineHeight);
    if (fill) {
      cellGlyphTransform = computeCellGlyphTransform({
        lineHeight,
        baseline: measureBaselineOffset(style),
        scaleY: fill.scaleY,
        inkAscent: fill.inkAscent,
        inkDescent: fill.inkDescent,
      });
    }
  }
  const root = document.documentElement.style;
  root.setProperty("--cell-glyph-scale", `${cellGlyphTransform.scaleY}`);
  root.setProperty("--cell-glyph-shift", `${cellGlyphTransform.shiftY}px`);
}

// ---- グリフ補正（全角文字の幅・罫線/ブロック文字のセル充填）----
/**
 * フォーマッタ出力のテキストノードを走査して、フォント任せだと崩れる文字をspanでラップする。
 * - 全角文字: <span class="wide"> で2セル幅に強制する（フォント任せだと桁がズレるため）
 * - 罫線・ブロック文字: <span class="cell-glyph"> で行の高さいっぱいに引き伸ばす
 *   （連続する分をまとめて1つのspanにするので、run内の文字送りは通常のテキストのまま）
 */
function fixGlyphs(root: HTMLElement) {
  // 変換が恒等（行の高さ＝フォントのセル高）なら罫線・ブロック文字のラップは不要
  const fillCellGlyphs = !isIdentityCellGlyphTransform(cellGlyphTransform);
  const needsFix = (cp: number) => isWideChar(cp) || (fillCellGlyphs && isCellGlyphChar(cp));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node as Text).data;
    for (const ch of text) {
      if (needsFix(ch.codePointAt(0) ?? 0)) {
        targets.push(node as Text);
        break;
      }
    }
  }
  for (const node of targets) {
    const frag = document.createDocumentFragment();
    let narrow = "";
    let cellRun = "";
    const flushNarrow = () => {
      if (!narrow) return;
      frag.appendChild(document.createTextNode(narrow));
      narrow = "";
    };
    const flushCellRun = () => {
      if (!cellRun) return;
      const span = document.createElement("span");
      span.className = "cell-glyph";
      span.textContent = cellRun;
      frag.appendChild(span);
      cellRun = "";
    };
    for (const ch of node.data) {
      const cp = ch.codePointAt(0) ?? 0;
      if (fillCellGlyphs && isCellGlyphChar(cp)) {
        flushNarrow();
        cellRun += ch;
        continue;
      }
      flushCellRun();
      if (isWideChar(cp)) {
        flushNarrow();
        const span = document.createElement("span");
        span.className = "wide";
        span.textContent = ch;
        frag.appendChild(span);
      } else {
        narrow += ch;
      }
    }
    flushCellRun();
    flushNarrow();
    node.parentNode?.replaceChild(frag, node);
  }
}

// ---- タイル木構造 → DOM reconciliation ----
function renderLayout(layout: TileNode, tabs: Record<TabId, TabRenderState>): void {
  const seenTabIds = new Set<TabId>();
  const seenSplitIds = new Set<TileId>();
  const seenTileIds = new Set<TileId>();
  const rootEl = reconcile(layout, tabs, seenTabIds, seenSplitIds, seenTileIds, true);
  if (rootEl.parentElement !== tileTreeEl) {
    tileTreeEl.appendChild(rootEl);
  }
  gcStale(seenTabIds, seenSplitIds, seenTileIds);
}

/**
 * ズーム中、対象タイルを含まない枝をdisplay:noneで丸ごと隠す（`visible`を再帰の入口で最初に
 * 適用してから子を辿る）。display:noneのflex itemはレイアウト計算から除外されるため、
 * 対象を含む枝が自然に100%へ広がる（position/z-indexでの重ね合わせは行わない。z-indexだけでは
 * 背後のタイルが透けて見える・カーソルが二重に見える）。
 * visibleを子より先に確定させる理由: setTabVisible()はhidden→visible遷移時にsendResize()で
 * 実寸を測り直すが、その時点でまだ祖先がdisplay:noneのままだと0サイズを誤って測ってしまう
 * （親から先に確定させる木構造の走査なので、これは子を処理する前に済ませる必要がある）
 */
function reconcile(
  node: TileNode,
  tabs: Record<TabId, TabRenderState>,
  seenTabIds: Set<TabId>,
  seenSplitIds: Set<TileId>,
  seenTileIds: Set<TileId>,
  visible: boolean,
): HTMLElement {
  if (node.kind === "leaf") {
    seenTileIds.add(node.id);
    activeTabByTile.set(node.id, node.activeTabId);

    let tileEl = tileElByTileId.get(node.id);
    let tabBarEl: HTMLDivElement;
    let tileContentEl: HTMLDivElement;
    if (!tileEl) {
      const frag = tileTemplate.content.cloneNode(true) as DocumentFragment;
      tileEl = frag.querySelector(".tile") as HTMLElement;
      tabBarEl = tileEl.querySelector(".tab-bar") as HTMLDivElement;
      tileContentEl = tileEl.querySelector(".tile-content") as HTMLDivElement;
      tileElByTileId.set(node.id, tileEl);
      tabBarElByTileId.set(node.id, tabBarEl);
      tabBarReactRootByTileId.set(node.id, createMemoRoot(tabBarEl, `tab-bar:${node.id}`));
    } else {
      tabBarEl = tabBarElByTileId.get(node.id) as HTMLDivElement;
      tileContentEl = tileEl.querySelector(".tile-content") as HTMLDivElement;
    }
    tileEl.dataset["tileId"] = node.id;
    tileEl.style.display = visible ? "" : "none";

    tabIdsByTileId.set(node.id, [...node.tabIds]);
    node.tabIds.forEach((tabId) => {
      seenTabIds.add(tabId);
      const renderState = tabs[tabId];
      if (renderState) ensureTabContent(tabId, tileContentEl, renderState);
      setTabVisible(tabId, tabId === node.activeTabId && visible);
    });
    renderTileTabBar(node.id);

    return tileEl;
  }

  seenSplitIds.add(node.id);
  let splitEl = splitElBySplitId.get(node.id);
  if (!splitEl) {
    splitEl = document.createElement("div");
    splitEl.className = "split";
    splitElBySplitId.set(node.id, splitEl);
  }
  splitEl.dataset["splitId"] = node.id;
  splitEl.dataset["direction"] = node.direction;
  splitEl.style.display = visible ? "" : "none";

  const firstVisible =
    visible && (zoomedTileId === null || findNode(node.first, zoomedTileId) !== undefined);
  const secondVisible =
    visible && (zoomedTileId === null || findNode(node.second, zoomedTileId) !== undefined);
  const firstEl = reconcile(node.first, tabs, seenTabIds, seenSplitIds, seenTileIds, firstVisible);
  const dividerEl = getOrCreateDivider(node.id);
  const secondEl = reconcile(
    node.second,
    tabs,
    seenTabIds,
    seenSplitIds,
    seenTileIds,
    secondVisible,
  );
  dividerEl.style.display = visible && zoomedTileId === null ? "" : "none";

  // ドラッグ確定後、bunのtreeが確定ratioに追いついたら以後はtree由来のratioに戻す
  if (
    pendingSplitRatio?.splitId === node.id &&
    Math.abs(node.ratio - pendingSplitRatio.ratio) < 0.001
  ) {
    pendingSplitRatio = null;
  }
  // ドラッグ中・ドラッグ確定直後（bunのratio確定待ち）はローカルのratioを保持し、
  // bunからの（まだ古い場合がある）ratioで上書きしない
  if (node.id !== draggingSplitId) {
    if (zoomedTileId !== null) {
      // ズーム中は非表示側のratioに関わらず、表示側を「1 0 0%」で100%まで広げる。
      // 実機診断で確認した挙動: 非表示側があってもtree由来のratio（例: 0.45）を
      // そのままflex-growに使うと、なぜか「コンテナの45%」で頭打ちになり広がらない
      // （非表示側はflex計算から除外されるはずだが、実際にはそうならない）。
      // ズーム中はratioで分け合う相手がいないため、常に1を使えば正しく広がる
      firstEl.style.flex = firstVisible ? "1 0 0%" : "";
      secondEl.style.flex = secondVisible ? "1 0 0%" : "";
    } else {
      const ratio = pendingSplitRatio?.splitId === node.id ? pendingSplitRatio.ratio : node.ratio;
      firstEl.style.flex = `${ratio} 0 0%`;
      secondEl.style.flex = `${1 - ratio} 0 0%`;
    }
  }

  // 既に同じ並びで入っているならappendChildしない。appendChildは「既に子である要素」に対しても
  // 一度外して入れ直す扱いになり、毎フレーム走らせるとBlinkがその都度レイアウトを作り直す
  const children = [firstEl, dividerEl, secondEl];
  const alreadyInOrder =
    splitEl.childElementCount === children.length &&
    children.every((child, index) => splitEl.children[index] === child);
  if (!alreadyInOrder) {
    for (const child of children) splitEl.appendChild(child);
  }

  return splitEl;
}

function getOrCreateDivider(splitId: TileId): HTMLDivElement {
  let dividerEl = dividerElBySplitId.get(splitId);
  if (!dividerEl) {
    dividerEl = document.createElement("div");
    dividerEl.className = "divider";
    attachDividerDrag(dividerEl, splitId);
    dividerElBySplitId.set(splitId, dividerEl);
  }
  return dividerEl;
}

/**
 * tabId用の.tab-contentを種別に応じて必要なら生成する。
 * 既に存在する場合は、タブがD&D等で別タイルへ移った可能性があるため、
 * 親がtileContentElと異なっていればそこへ再appendする（種別自体は初回のrenderで固定）。
 */
function ensureTabContent(
  tabId: TabId,
  tileContentEl: HTMLDivElement,
  renderState: TabRenderState,
): void {
  const existing = tabContentElByTabId.get(tabId);
  if (existing) {
    if (existing.parentElement !== tileContentEl) tileContentEl.appendChild(existing);
    return;
  }
  if (renderState.kind === "terminal") {
    ensureTerminalTabContent(tabId, tileContentEl);
  } else {
    ensureBrowserTabContent(tabId, tileContentEl, renderState.url);
  }
}

/** ターミナルタブ用の.term/.cursorペア（.tab-content）を生成し、ResizeObserverを設置する */
function ensureTerminalTabContent(tabId: TabId, tileContentEl: HTMLDivElement): void {
  const frag = tabContentTemplate.content.cloneNode(true) as DocumentFragment;
  const tabContentEl = frag.querySelector(".tab-content") as HTMLDivElement;
  const termEl = tabContentEl.querySelector(".term") as HTMLDivElement;
  const cursorEl = tabContentEl.querySelector(".cursor") as HTMLDivElement;
  const copyOverlayEl = tabContentEl.querySelector(".copy-overlay") as HTMLDivElement;
  tabContentElByTabId.set(tabId, tabContentEl);
  termElByTabId.set(tabId, termEl);
  cursorElByTabId.set(tabId, cursorEl);
  copyOverlayElByTabId.set(tabId, copyOverlayEl);
  tileContentEl.appendChild(tabContentEl);
  const ro = new ResizeObserver(() => {
    // ドラッグ中・ドラッグ確定直後（bun側のratio確定待ち）はスキップ。
    // 非アクティブタブ（display:none）はcontent-boxが0になり誤って2x2等のresizeを
    // 送ってしまうため、表示中でない限りスキップする（再表示時に正しいサイズで発火し直す）
    if (draggingSplitId || pendingSplitRatio || draggingSidebar) return;
    if (tabContentEl.style.display === "none") return;
    sendResize(tabId);
  });
  ro.observe(termEl);
  resizeObserverByTabId.set(tabId, ro);
}

/**
 * ブラウザタブ用の<electrobun-webview>とツールバー（戻る/進む/リロード/URL入力欄）を生成する。
 * リサイズはElectrobun側のOverlaySyncControllerがDOM位置に自動追従するため、
 * ターミナルタブと異なりResizeObserver/sendResizeは付けない。
 * sandbox/src属性はDOM追加（connectedCallback）より前に設定する必要がある。
 */
function ensureBrowserTabContent(tabId: TabId, tileContentEl: HTMLDivElement, url: string): void {
  const tabContentEl = document.createElement("div");
  tabContentEl.className = "tab-content browser";

  // "browser-toolbar"クラス名は、tileTreeElのmousedown委譲に残る
  // target.closest(".browser-toolbar")判定を変えずに済ませるため維持する
  const toolbarEl = document.createElement("div");
  toolbarEl.className = "browser-toolbar";

  const webviewEl = document.createElement("electrobun-webview") as WebviewTagElement;
  webviewEl.setAttribute("sandbox", "");
  webviewEl.src = url;

  const toolbarRoot = createMemoRoot(toolbarEl, `browser-toolbar:${tabId}`);
  browserToolbarRootByTabId.set(tabId, toolbarRoot);
  toolbarRoot.renderOnEvent(
    createElement(BrowserToolbar, {
      webviewEl,
      initialUrl: url,
      onRequestTerminalFocus: () => imeEl.focus({ preventScroll: true }),
    }),
  );

  browserDomReadyByTabId.set(tabId, false);
  webviewEl.on("dom-ready", () => {
    browserDomReadyByTabId.set(tabId, true);
  });

  // execBrowserJsの結果送信を待ち受ける。host-message detailはbrowser-js-bridge.tsが
  // window.__electrobunEventBridge経由で送ってくる{requestId, ok, result|error}
  webviewEl.on("host-message", (e) => {
    const detail = (e as CustomEvent).detail as {
      requestId?: unknown;
      ok?: unknown;
      result?: unknown;
      error?: unknown;
    } | null;
    const requestId = typeof detail?.requestId === "string" ? detail.requestId : null;
    if (!requestId) return;
    const pending = execJsPendingByRequestId.get(requestId);
    if (!pending) return;
    execJsPendingByRequestId.delete(requestId);
    pending.resolve(
      detail?.ok === true
        ? { ok: true, result: (detail as { result: unknown }).result }
        : { ok: false, error: typeof detail?.error === "string" ? detail.error : "unknown error" },
    );
  });

  tabContentEl.appendChild(toolbarEl);
  tabContentEl.appendChild(webviewEl);
  tabContentElByTabId.set(tabId, tabContentEl);
  browserElByTabId.set(tabId, webviewEl);
  tileContentEl.appendChild(tabContentEl);
}

/**
 * ブラウザタブ（OOPIF）内でcodeを実行し、host-message経由の結果を待って返す。
 * webviewId未確定・dom-ready未発火（初回ロード未完了）なら即座に失敗を返す。
 * 内部タイムアウトで必ずresolveする（外側のNiwaRPC maxRequestTimeは最終防波堤）。
 */
function execBrowserJs(
  tabId: TabId,
  code: string,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const webviewEl = browserElByTabId.get(tabId);
  if (!webviewEl) {
    return Promise.resolve({
      ok: false,
      error: "browser tab not found (workspace may be inactive)",
    });
  }
  if (webviewEl.webviewId == null || !browserDomReadyByTabId.get(tabId)) {
    return Promise.resolve({ ok: false, error: "browser tab has not finished loading yet" });
  }
  const requestId = `${execJsRequestIdPrefix(tabId)}${++execJsRequestSeq}`;
  return new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      if (execJsPendingByRequestId.delete(requestId)) {
        resolve({ ok: false, error: "browser js execution timed out" });
      }
    }, EXEC_JS_TIMEOUT_MS);
    execJsPendingByRequestId.set(requestId, {
      resolve: (r) => {
        clearTimeout(timeoutHandle);
        resolve(r);
      },
    });
    webviewEl.executeJavascript(buildExecBrowserJsScript(requestId, code));
  });
}

/**
 * ブラウザタブのURLを遷移し、次のdom-ready（またはタイムアウト）まで待って解決する
 * （Playwrightのpage.goto()同様、読み込み完了を待つ）。
 */
function browserNavigate(
  tabId: TabId,
  url: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const webviewEl = browserElByTabId.get(tabId);
  if (!webviewEl) {
    return Promise.resolve({
      ok: false,
      error: "browser tab not found (workspace may be inactive)",
    });
  }
  if (webviewEl.webviewId == null) {
    return Promise.resolve({ ok: false, error: "browser tab is not ready yet" });
  }
  const normalized = normalizeUrl(url);
  return new Promise((resolve) => {
    let settled = false;
    const onDomReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      webviewEl.off("dom-ready", onDomReady);
      resolve({ ok: true });
    };
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      webviewEl.off("dom-ready", onDomReady);
      resolve({ ok: false, error: "navigation timed out waiting for page load" });
    }, NAVIGATE_LOAD_TIMEOUT_MS);
    webviewEl.on("dom-ready", onDomReady);
    webviewEl.loadURL(normalized);
  });
}

/**
 * タブの表示/非表示を切り替える。ブラウザタブはdisplay:noneだけでは
 * ネイティブOOPIFが隠れない（位置同期が0x0でスキップされ直前の位置に居座る）ため、
 * toggleHiddenも併せて呼ぶ必要がある。
 * さらにtoggleHiddenだけでは描画が消えてもマウスイベントは奪われたままで、背面に来た
 * ターミナルがクリック・ホバーに反応しなくなるため、togglePassthroughも併せて呼ぶ
 * （docs/known-issues/electrobun-hidden-webview-still-eats-mouse-events.md）。
 */
function setTabVisible(tabId: TabId, visible: boolean): void {
  const tabContentEl = tabContentElByTabId.get(tabId);
  if (tabContentEl) {
    const wasHidden = tabContentEl.style.display === "none";
    // ""に戻すことでCSS側のdisplay指定（ターミナルはblock、ブラウザは.browserのflex）に委ねる
    tabContentEl.style.display = visible ? "" : "none";
    // 非表示中に他のタブ/ウィンドウ操作でサイズが変わっても、非アクティブタブはresizeObserverの
    // コールバックがdisplay:none判定でスキップされ続けるため、再表示時に確定サイズで送り直す
    // （ドラッグ確定後にactiveTabByTile分だけ送り直すのと同じ理由。あちらは表示中のタブしか
    // 拾えないため、背面にいたタブはここで拾う必要がある）
    if (visible && wasHidden) sendResize(tabId);
  }
  const browserEl = browserElByTabId.get(tabId);
  browserEl?.toggleHidden(!visible);
  browserEl?.togglePassthrough(!visible);
}

// ---- ポップアップ（タイルに所属しない一時的な画面。ADR 0005）----
// 中身は.tile内のターミナルと同じ.term/.cursorのDOM描画方式を流用する。DOM要素自体は
// index.htmlに静的に用意済みなので、termElByTabId/cursorElByTabIdへの登録・解除のみ行う。
// tabContentElByTabIdには登録しない（gcStaleがTile木構造由来のtabIdのみを生存対象とするため、
// 登録すると次のrenderで誤って除去されてしまう）
function setupPopupContent(tabId: TabId): void {
  currentPopupTabId = tabId;
  termElByTabId.set(tabId, popupTermEl);
  cursorElByTabId.set(tabId, popupCursorEl);
  copyOverlayElByTabId.set(tabId, popupCopyOverlayEl);
  popupResizeObserver = new ResizeObserver(() => {
    if (!popupVisible || !currentPopupTabId) return;
    sendResize(currentPopupTabId);
  });
  popupResizeObserver.observe(popupTermEl);
}

function teardownPopupContent(): void {
  if (!currentPopupTabId) return;
  popupResizeObserver?.disconnect();
  popupResizeObserver = null;
  // 昇格（promote）時はrenderLayout()が先に走り、同じtabIdへ新しい.term/.cursorを
  // 登録し直している可能性がある（ensureTabContentはtabContentElByTabIdに未登録のpopup分を
  // 「新規タブ」とみなし、termElByTabId/cursorElByTabIdを上書きするため）。
  // まだpopup自身のDOM要素を指している場合のみ削除し、昇格済みの正しい登録は残す
  if (termElByTabId.get(currentPopupTabId) === popupTermEl) {
    termElByTabId.delete(currentPopupTabId);
  }
  if (cursorElByTabId.get(currentPopupTabId) === popupCursorEl) {
    cursorElByTabId.delete(currentPopupTabId);
  }
  if (copyOverlayElByTabId.get(currentPopupTabId) === popupCopyOverlayEl) {
    copyOverlayElByTabId.delete(currentPopupTabId);
    copyModeTabIds.delete(currentPopupTabId);
    copyModeSearchTabIds.delete(currentPopupTabId);
  }
  // 昇格後（tabContentElByTabIdへ通常タブとして登録済み）はスクロール状態をリセットすべきでない
  if (!tabContentElByTabId.has(currentPopupTabId)) {
    wheelAccumPxByTabId.delete(currentPopupTabId);
    wheelAccumPxXByTabId.delete(currentPopupTabId);
    mouseTrackingByTabId.delete(currentPopupTabId);
  }
  popupTermEl.innerHTML = "";
  currentPopupTabId = null;
}

/**
 * bunから届いたポップアップのメタ情報をDOM側へ反映する。HTML本体はp.workspace.tabs経由の
 * 既存のterminalタブ更新ループが（termElByTabIdへ登録済みなら）自動的に流し込むためここでは扱わない
 */
function applyPopupState(
  popup: { tabId: TabId; visible: boolean; width?: number; height?: number } | null,
): void {
  if (!popup) {
    popupVisible = false;
    popupEl.hidden = true;
    teardownPopupContent();
    return;
  }
  if (currentPopupTabId !== popup.tabId) {
    teardownPopupContent();
    setupPopupContent(popup.tabId);
  }
  const becameVisible = popup.visible && !popupVisible;
  popupVisible = popup.visible;
  popupEl.hidden = !popup.visible;
  // 未指定時は空文字列に戻しCSS側の既定値（80%）を使う
  popupBoxEl.style.width = popup.width !== undefined ? `${popup.width}%` : "";
  popupBoxEl.style.height = popup.height !== undefined ? `${popup.height}%` : "";
  // 再表示直後は確定サイズを送り直す（非表示中はResizeObserverが動いてもスキップしているため。setTabVisibleと同じ理由）
  if (popup.visible) sendResize(popup.tabId);
  // 開く・再表示のタイミングでキー入力の受け口(imeEl)へ明示的にフォーカスを移す。
  // これが無いと、開いた直後は一度マウスでクリックするまでキー入力が届かない
  // （これが無いとフォーカスはpopupEl.mousedownリスナー経由でしか移らない）
  if (becameVisible) imeEl.focus({ preventScroll: true });
}

/** 開いていなければ新規に開き、開いていれば表示⇔非表示を切り替える */
function togglePopup(): void {
  if (currentPopupTabId) {
    sendMessage("togglePopupVisibility");
  } else {
    sendMessage("openPopup");
  }
}

popupEl.addEventListener("mousedown", () => {
  if (!currentPopupTabId) return;
  currentTabId = currentPopupTabId;
  imeEl.focus({ preventScroll: true });
});

/** クリック/キー操作でのタブ切替をローカルへ即時反映する（次のrenderを待たず入力送信先を切り替えるため） */
function setActiveTabLocally(tileId: TileId, tabId: TabId): void {
  const previousActive = activeTabByTile.get(tileId);
  if (previousActive === tabId) return;
  activeTabByTile.set(tileId, tabId);
  if (previousActive) setTabVisible(previousActive, false);
  setTabVisible(tabId, true);
  renderTileTabBar(tileId);
}

/**
 * tileIdのタブバーReact rootへ最新propsで再renderする。lastLayoutから対象leafを都度引く。
 *
 * **propsが前回と同じなら`root.render()`自体を呼ばない。** reconcile()がこれをrenderメッセージの
 * たびに（＝ターミナルが出力するたび、最大60fps × タイル数）呼ぶため、無条件にrenderすると
 * rendererプロセスのメモリがJSヒープ外（Blink側）へ積み上がって解放されない。Windowsでは
 * 約5MB/秒増え続け、数時間でWebView2 rendererがOOMクラッシュしてウィンドウが真っ白になる
 * （DOMノード数もJSヒープも横ばいのまま増えるので、JS側からは見えないリーク）。
 * タブバーの内容はタブの増減・改名・切替でしか変わらないので、その変化だけをキーで見る。
 */
function renderTileTabBar(tileId: TileId): void {
  const root = tabBarReactRootByTileId.get(tileId);
  if (!root || !lastLayout) return;
  const leaf = findNode(lastLayout, tileId);
  if (!leaf || leaf.kind !== "leaf") return;
  const tabs = leaf.tabIds.map((tabId, index) => ({
    tabId,
    label: lastTabNames[tabId] || String(index + 1),
  }));
  const zoomed = zoomedTileId === tileId;
  let key = `${shellProfilesVersion}\u0000${leaf.activeTabId}\u0000${zoomed}`;
  for (const tab of tabs) key += `\u0000${tab.tabId}\u0001${tab.label}`;
  root.renderIfChanged(key, () =>
    createElement(TileTabBar, {
      tileId,
      tabs,
      activeTabId: leaf.activeTabId,
      zoomed,
      shellProfiles,
      onSelectTab: (tabId) => {
        switchToTab(tileId, tabId);
        imeEl.focus({ preventScroll: true });
      },
      onCloseTab: (tabId) => {
        sendMessage("closeTab", { tileId, tabId });
        imeEl.focus({ preventScroll: true });
      },
      onAddTab: () => {
        focusTileLocally(tileId);
        sendMessage("newTab", { tileId });
        imeEl.focus({ preventScroll: true });
      },
      onAddTabWithProfile: (shellProfileId) => {
        focusTileLocally(tileId);
        sendMessage("newTab", shellProfileId ? { tileId, shellProfileId } : { tileId });
        imeEl.focus({ preventScroll: true });
      },
      onRequestTerminalFocus: () => imeEl.focus({ preventScroll: true }),
      onRenameTab: renameSidebarTab,
      onToggleZoom: () => {
        focusTileLocally(tileId);
        sendMessage("toggleZoomTile", { tileId });
      },
    }),
  );
}

/** 前回登場したが今回登場しなかったtab/split/tileの後始末（DOM除去・ResizeObserver停止） */
function gcStale(
  seenTabIds: Set<TabId>,
  seenSplitIds: Set<TileId>,
  seenTileIds: Set<TileId>,
): void {
  // 個別に閉じられたタブ（タイル自体は生存）の後始末。.tab-content単位で除去し、
  // 同じタイルに残る他のタブには影響しない。.remove()でブラウザタブは
  // disconnectedCallbackが自動発火しネイティブ側リソースも解放される
  for (const tabId of tabContentElByTabId.keys()) {
    if (seenTabIds.has(tabId)) continue;
    resizeObserverByTabId.get(tabId)?.disconnect();
    resizeObserverByTabId.delete(tabId);
    resizeSentTabIds.delete(tabId);
    tabContentElByTabId.get(tabId)?.remove();
    tabContentElByTabId.delete(tabId);
    termElByTabId.delete(tabId);
    cursorElByTabId.delete(tabId);
    copyOverlayElByTabId.delete(tabId);
    copyModeTabIds.delete(tabId);
    copyModeSearchTabIds.delete(tabId);
    wheelAccumPxByTabId.delete(tabId);
    wheelAccumPxXByTabId.delete(tabId);
    mouseTrackingByTabId.delete(tabId);
    browserElByTabId.delete(tabId);
    browserDomReadyByTabId.delete(tabId);
    browserToolbarRootByTabId.get(tabId)?.unmount();
    browserToolbarRootByTabId.delete(tabId);
    const pendingPrefix = execJsRequestIdPrefix(tabId);
    for (const [requestId, pending] of execJsPendingByRequestId) {
      if (!requestId.startsWith(pendingPrefix)) continue;
      execJsPendingByRequestId.delete(requestId);
      pending.resolve({ ok: false, error: "browser tab was closed" });
    }
  }
  // タイルごと閉じられた場合の後始末（配下のタブは上のループで既に個別除去済み）
  for (const [tileId, tileEl] of tileElByTileId) {
    if (seenTileIds.has(tileId)) continue;
    tabBarReactRootByTileId.get(tileId)?.unmount();
    tabBarReactRootByTileId.delete(tileId);
    tileEl.remove();
    tileElByTileId.delete(tileId);
    tabBarElByTileId.delete(tileId);
  }
  for (const [splitId, splitEl] of splitElBySplitId) {
    if (seenSplitIds.has(splitId)) continue;
    splitEl.remove();
    splitElBySplitId.delete(splitId);
    dividerElBySplitId.get(splitId)?.remove();
    dividerElBySplitId.delete(splitId);
  }
  for (const tileId of activeTabByTile.keys()) {
    if (!seenTileIds.has(tileId)) activeTabByTile.delete(tileId);
  }
  for (const tileId of tabIdsByTileId.keys()) {
    if (!seenTileIds.has(tileId)) tabIdsByTileId.delete(tileId);
  }
}

// ---- サイドバー: ワークスペース＋タブのフラット一覧 → DOM reconciliation ----
// タイル木のreconcileとは別系統のMap・gcを使う（全ワークスペースを描画するため）
function renderSidebar(
  workspaces: WorkspaceListEntry[],
  currentActiveWorkspaceId: WorkspaceId | null,
): void {
  // renderTileTabBarと同じ理由で、内容が変わらないrenderは省く。
  // buildSidebarWorkspaceItemsは引数だけで決まる純関数なので、入力側をキーにすれば足りる
  const key = `${currentActiveWorkspaceId}\u0000${JSON.stringify(workspaces)}`;
  sidebarWorkspaceListRoot.renderIfChanged(key, () =>
    createElement(SidebarWorkspaceList, {
      workspaces: buildSidebarWorkspaceItems(workspaces, currentActiveWorkspaceId),
      onSelectWorkspaceHeader: activateSidebarWorkspace,
      onSelectBoard: activateSidebarBoard,
      onSelectPopup: activateSidebarPopup,
      onRenameBoard: renameSidebarBoard,
      onRenameWorkspace: renameSidebarWorkspace,
      onCloseBoard: closeSidebarBoard,
      onRequestBoardLayouts: requestSidebarBoardLayouts,
      onApplyBoardLayout: applySidebarBoardLayout,
      onClearBoardStartup: clearSidebarBoardStartup,
      onMoveWorkspace: moveSidebarWorkspace,
      onMoveBoard: moveSidebarBoard,
    }),
  );
}

/** サイドバーのワークスペース見出しクリック。既にアクティブなワークスペースなら何もしない */
function activateSidebarWorkspace(workspaceId: WorkspaceId): void {
  if (workspaceId === activeWorkspaceId) return;
  sendMessage("switchWorkspace", { workspaceId });
  imeEl.focus({ preventScroll: true });
}

/**
 * サイドバーのBoard行クリック。非アクティブワークスペースなら先に切り替える。
 * タブ切替と異なりローカル即時反映は持たず、switchBoard結果は次のrenderブロードキャストを待つ
 * （Board切替はタイル木そのものが入れ替わるため、DOM側の先行更新は行わない）
 */
function activateSidebarBoard(workspaceId: WorkspaceId, boardId: BoardId): void {
  if (workspaceId !== activeWorkspaceId) {
    sendMessage("switchWorkspace", { workspaceId });
  }
  sendMessage("switchBoard", { boardId });
  imeEl.focus({ preventScroll: true });
}

/**
 * サイドバーのD&Dによるワークスペース並び替え。挿入先の計算はSidebarWorkspaceList側が済ませており、
 * ここでは0始まりのtoIndexをそのまま送る（範囲外のクランプはbun側の責務）
 */
function moveSidebarWorkspace(workspaceId: WorkspaceId, toIndex: number): void {
  sendMessage("moveWorkspace", { workspaceId, toIndex });
  imeEl.focus({ preventScroll: true });
}

/**
 * サイドバーのD&DによるBoard並び替え。挿入先の計算はSidebarWorkspaceList側が済ませており、
 * ここでは所属ワークスペース内の0始まりのtoIndexをそのまま送る（範囲外のクランプはbun側の責務）
 */
function moveSidebarBoard(boardId: BoardId, toIndex: number): void {
  sendMessage("moveBoard", { boardId, toIndex });
  imeEl.focus({ preventScroll: true });
}

/** サイドバーからのBoard名変更。空文字列を送るとbun側でデフォルトの連番ラベルへ戻る */
function renameSidebarBoard(boardId: BoardId, name: string): void {
  sendMessage("renameBoard", { boardId, name });
  imeEl.focus({ preventScroll: true });
}

/**
 * サイドバーからのBoard削除。Board内の全タイル・全タブのPTYがまとめて落ちる破壊的操作なので、
 * タブ再起動と同じ確認ダイアログを挟む。ワークスペース内最後の1つはbun側が閉じない
 * （SidebarWorkspaceList側でもメニュー項目を無効化しているので、ここには来ない想定）
 */
function closeSidebarBoard(boardId: BoardId, name: string): void {
  openConfirmDialog(
    `Board「${name}」を削除しますか？`,
    "実行中のプロセスは強制終了されます。",
    () => {
      sendMessage("closeBoard", { boardId });
    },
  );
}

/**
 * 起動時レイアウトのサブメニューを開いたときのプリセット一覧取得。プロジェクトローカルの
 * プリセットはbun側が対象Boardのcwdから解決するため、ここではboardIdを渡すだけでよい
 */
async function requestSidebarBoardLayouts(boardId: BoardId): Promise<LayoutListEntry[]> {
  const result = await rpc.request.listBoardLayouts({ boardId });
  return result.layouts;
}

/**
 * サイドバーで選んだレイアウトプリセットの適用。Board内の既存タブ・PTYがすべて閉じられる
 * 破壊的操作なので、Board削除と同じ確認ダイアログを挟む。
 *
 * さらにプロジェクトローカル由来のプリセットは、起動時レイアウトへの紐づけによって以後
 * アプリを起動するたびにそのリポジトリの.niwaterm/config.tsが評価され、プリセットのcommandが
 * 実行されることになる。CLIはtrust確認と破壊的確認を2回に分けて聞くが（layout-trust.ts）、
 * GUIでモーダルを2枚続けるより1枚へまとめた方が読み飛ばされにくいため、文面を合わせて出す
 */
function applySidebarBoardLayout(request: SidebarApplyLayoutRequest): void {
  // trustはユーザーが実際に同意したときだけ付ける。ここで一律に付けると、webview側が
  // グローバル由来だと思ったプリセットをbun側がプロジェクトローカルと解決した場合に
  // 確認なしで通ってしまう（その食い違いはbun側のゲートで弾かれるべきもの）
  const send = (trust: boolean) =>
    sendMessage("applyBoardLayout", {
      boardId: request.boardId,
      preset: request.preset,
      ...(trust ? { trust } : {}),
    });
  const destructive = `${request.boardLabel}の既存タブ・プロセスはすべて閉じられます。次回の起動時もこのプリセットで組み直します。`;
  if (!request.projectRoot) {
    openConfirmDialog(`レイアウト「${request.preset}」を適用しますか？`, destructive, () =>
      send(false),
    );
    return;
  }
  openConfirmDialog(
    `レイアウト「${request.preset}」を適用しますか？`,
    `${destructive}このプリセットは ${request.projectRoot}/.niwaterm/config.ts で定義されているため、起動のたびにこのファイルが評価され、プリセットのcommandが実行されます。信頼できるリポジトリでのみ許可してください。`,
    () => send(true),
  );
}

/**
 * サイドバーからの起動時レイアウトの紐づけ解除。今のレイアウトはそのまま残り、次回起動時に
 * 保存した骨格を復元する既定の挙動へ戻るだけなので確認は挟まない
 */
function clearSidebarBoardStartup(boardId: BoardId): void {
  sendMessage("clearBoardStartup", { boardId });
}

/**
 * キーバインド・コマンドパレットからのアクティブBoardの名前変更。サイドバーのインライン編集と違い
 * サイドバーの表示状態に依存しないよう、入力ダイアログで受ける（初期値・空文字列の扱いは
 * サイドバー側と揃える）
 */
function openRenameActiveBoardDialog(): void {
  const boardId = activeBoardId;
  if (!boardId) return;
  const workspace = lastWorkspaces.find((w) => w.workspaceId === activeWorkspaceId);
  const index = workspace?.boards.findIndex((b) => b.boardId === boardId) ?? -1;
  const board = index >= 0 ? workspace?.boards[index] : undefined;
  if (!board) return;
  openPromptDialog(
    "Boardの名前を変更",
    "空のまま確定すると既定の連番ラベルへ戻ります。",
    boardLabel(board, index),
    (name) => {
      sendMessage("renameBoard", { boardId, name });
    },
  );
}

/** タイルのタブバーからのタブ名変更。空文字列を送るとbun側でデフォルトの連番ラベルへ戻る */
function renameSidebarTab(tabId: TabId, name: string): void {
  sendMessage("renameTab", { tabId, name });
  imeEl.focus({ preventScroll: true });
}

/** サイドバーからのワークスペース名変更。空文字列を送るとbun側でデフォルトの連番ラベルへ戻る */
function renameSidebarWorkspace(workspaceId: WorkspaceId, name: string): void {
  sendMessage("renameWorkspace", { workspaceId, name });
  imeEl.focus({ preventScroll: true });
}

function renderSidebarSwitcher(): void {
  sidebarSwitcherRoot.renderOnEvent(
    createElement(SidebarSwitcher, {
      customViewName: customViewName ?? "",
      showingCustom: sidebarShowingCustom,
      onShowList: () => setSidebarShowingCustom(false),
      onShowCustom: () => setSidebarShowingCustom(true),
    }),
  );
}

/**
 * サイドバーの一覧/カスタムビュー表示を切り替える。
 * #sidebar-listはhidden属性で、#sidebar-custom-view内のOOPIFはtoggleHiddenで隠す
 * （OOPIFはdisplay:noneだけでは隠れないため）。#sidebar-custom-view自体は常にレイアウトを
 * 持たせたままにする必要があるため、非アクティブ時の見た目上の無効化はpointer-events経由で行う。
 * ただしOOPIFはネイティブのオーバーレイなのでCSSのpointer-eventsが効かず、toggleHiddenで
 * 見えなくしてもマウスイベントだけは奪い続ける（＝#sidebar-listのクリックが死ぬ）。
 * togglePassthroughを併用してネイティブ側でもイベントを素通りさせる必要がある。
 */
function setSidebarShowingCustom(showing: boolean): void {
  sidebarShowingCustom = showing;
  sidebarListEl.hidden = showing;
  sidebarCustomViewEl.classList.toggle("active", showing);
  setCustomViewWebviewActive(showing);
  renderSidebarSwitcher();
}

/** customViewのOOPIFの表示・マウスイベント受け取りをまとめて切り替える */
function setCustomViewWebviewActive(active: boolean): void {
  customViewWebviewEl?.toggleHidden(!active);
  customViewWebviewEl?.togglePassthrough(!active);
}

/** customView設定に合わせてサイドバーパネル用の<electrobun-webview>を作成/更新/破棄する */
function applyCustomView(customView: ResolvedCustomViewConfig | null): void {
  if (!customView) {
    sidebarSwitcherEl.hidden = true;
    if (sidebarShowingCustom) setSidebarShowingCustom(false);
    customViewWebviewEl?.remove();
    customViewWebviewEl = null;
    customViewUrl = null;
    return;
  }

  sidebarSwitcherEl.hidden = false;
  customViewName = customView.name;
  renderSidebarSwitcher();

  if (!customViewWebviewEl) {
    // #sidebar-custom-viewは常に有効なレイアウトを持つ（position:absolute; inset:0;）ため、
    // 生成時点から一度も0x0でOOPIFを同期させずに済み、toggleHiddenで正しく隠せる。
    // ただしtoggleHidden()/togglePassthrough()はwebviewId確定後でないと送信先が無く
    // 無視されるため、初回のみdom-readyを待ってから呼ぶ
    const webviewEl = document.createElement("electrobun-webview") as WebviewTagElement;
    webviewEl.setAttribute("sandbox", "");
    webviewEl.src = customView.url;
    webviewEl.on("dom-ready", () => {
      webviewEl.toggleHidden(!sidebarShowingCustom);
      webviewEl.togglePassthrough(!sidebarShowingCustom);
    });
    sidebarCustomViewEl.appendChild(webviewEl);
    customViewWebviewEl = webviewEl;
    customViewUrl = customView.url;
  } else if (customViewUrl !== customView.url) {
    customViewWebviewEl.loadURL(customView.url);
    customViewUrl = customView.url;
  }
}

function applySidebarVisibility(): void {
  sidebarEl.style.display = sidebarOpen ? "" : "none";
  sidebarDividerEl.style.display = sidebarOpen ? "" : "none";
}

function toggleSidebar(): void {
  sidebarOpen = !sidebarOpen;
  applySidebarVisibility();
  saveSidebarOpen(sidebarOpen);
  if (sidebarOpen) renderSidebar(lastWorkspaces, activeWorkspaceId);
}

function updateFocusHighlight(): void {
  for (const tileEl of tileTreeEl.querySelectorAll<HTMLElement>(".tile")) {
    tileEl.classList.toggle("focused", tileEl.dataset["tileId"] === focusedTileId);
    tileEl.classList.toggle("zoomed", tileEl.dataset["tileId"] === zoomedTileId);
  }
}

// ---- カーソル描画（タイルごと） ----
// DECSCUSRの視覚形状ごとにDOM要素のサイズ・位置を変える（bar=左端の縦線、underline=下端の横線、
// block_hollow=枠線のみ）。libghostty-vtからshape不明値が来た場合も安全にblock扱いへフォールバックする
function updateCursorForTab(
  tabId: TabId,
  x: number,
  y: number,
  visible: boolean,
  shape: CursorShape,
): void {
  const cursorEl = cursorElByTabId.get(tabId);
  if (!cursorEl) return;
  if (!visible) {
    cursorEl.style.display = "none";
    return;
  }
  cursorEl.style.display = "block";
  cursorEl.classList.toggle("shape-bar", shape === "bar");
  cursorEl.classList.toggle("shape-underline", shape === "underline");
  cursorEl.classList.toggle("shape-block-hollow", shape === "block_hollow");
  cursorEl.style.left = `${x * cellWidth}px`;
  switch (shape) {
    case "bar":
      cursorEl.style.top = `${y * cellHeight}px`;
      cursorEl.style.width = "2px";
      cursorEl.style.height = `${cellHeight}px`;
      break;
    case "underline":
      cursorEl.style.top = `${(y + 1) * cellHeight - 2}px`;
      cursorEl.style.width = `${cellWidth}px`;
      cursorEl.style.height = "2px";
      break;
    default:
      cursorEl.style.top = `${y * cellHeight}px`;
      cursorEl.style.width = `${cellWidth}px`;
      cursorEl.style.height = `${cellHeight}px`;
      break;
  }
}

/**
 * コピーモードの選択ハイライトとカーソルを、ターミナル描画の上に重ねるオーバーレイとして描く。
 * bun側が桁・行（ビューポート座標）まで確定させて送ってくるので、ここは実測セルサイズを
 * 掛けてピクセルへ直すだけにする（DOMのSelectionは使わない。描画のたびにinnerHTMLを
 * 差し替える方式では選択が消えてしまうため）
 */
function updateCopyModeForTab(tabId: TabId, copyMode: CopyModeRenderState | null): void {
  const overlayEl = copyOverlayElByTabId.get(tabId);
  if (!overlayEl) return;
  if (!copyMode) {
    copyModeTabIds.delete(tabId);
    copyModeSearchTabIds.delete(tabId);
    if (overlayEl.childElementCount > 0) overlayEl.replaceChildren();
    overlayEl.classList.remove("active");
    return;
  }
  copyModeTabIds.add(tabId);
  if (copyMode.searchPrompt === null) copyModeSearchTabIds.delete(tabId);
  else copyModeSearchTabIds.add(tabId);
  overlayEl.classList.add("active");
  const frag = document.createDocumentFragment();
  // 検索の一致は選択の下に敷く（選択したまま検索を続けても選択範囲が見えるように）
  for (const row of copyMode.searchRows) {
    const el = document.createElement("div");
    el.className = "search-hit";
    el.style.left = `${row.startX * cellWidth}px`;
    el.style.top = `${row.y * cellHeight}px`;
    el.style.width = `${(row.endX - row.startX + 1) * cellWidth}px`;
    el.style.height = `${cellHeight}px`;
    frag.appendChild(el);
  }
  for (const row of copyMode.selectionRows) {
    const el = document.createElement("div");
    el.className = "sel";
    el.style.left = `${row.startX * cellWidth}px`;
    el.style.top = `${row.y * cellHeight}px`;
    el.style.width = `${(row.endX - row.startX + 1) * cellWidth}px`;
    el.style.height = `${cellHeight}px`;
    frag.appendChild(el);
  }
  if (copyMode.cursor) {
    const el = document.createElement("div");
    el.className = "copy-cursor";
    el.style.left = `${copyMode.cursor.x * cellWidth}px`;
    el.style.top = `${copyMode.cursor.y * cellHeight}px`;
    el.style.width = `${cellWidth}px`;
    el.style.height = `${cellHeight}px`;
    frag.appendChild(el);
  }
  // 検索プロンプト・メッセージはvimのコマンドラインと同じく画面下端に出す
  if (copyMode.searchPrompt !== null || copyMode.message !== null) {
    const el = document.createElement("div");
    el.className = copyMode.searchPrompt !== null ? "copy-status" : "copy-status warn";
    el.textContent =
      copyMode.searchPrompt !== null ? `${copyMode.searchPrompt}▏` : (copyMode.message ?? "");
    frag.appendChild(el);
  }
  overlayEl.replaceChildren(frag);
}

/** スクロールバック閲覧中であることを示すバッジの表示切替（CSSの::afterで描画） */
function updateScrollIndicator(tabId: TabId, viewportPinned: boolean): void {
  const tabContentEl = tabContentElByTabId.get(tabId);
  tabContentEl?.classList.toggle("scrolled-history", !viewportPinned);
}

// IME候補ウィンドウと未確定文字列を、フォーカス中タイルのカーソル位置に追従させる
function updateImePosition(x: number, y: number): void {
  if (!currentTabId) return;
  const termEl = termElByTabId.get(currentTabId);
  if (!termEl) return;
  const termRect = termEl.getBoundingClientRect();
  const screenRect = screenEl.getBoundingClientRect();
  const left = termRect.left - screenRect.left + x * cellWidth;
  const top = termRect.top - screenRect.top + y * cellHeight;
  imeEl.style.left = `${left}px`;
  imeEl.style.top = `${top}px`;
  compositionEl.style.left = `${left}px`;
  compositionEl.style.top = `${top}px`;
}

// ---- リサイズ（タイルごと） ----
function sendResize(tabId: TabId): void {
  measureCell();
  const termEl = termElByTabId.get(tabId);
  if (!termEl) return;
  const cols = Math.max(2, Math.floor(termEl.clientWidth / cellWidth));
  const rows = Math.max(2, Math.floor(termEl.clientHeight / cellHeight));
  sendMessage("resize", { tabId, cols, rows, cellWidth, cellHeight });
  resizeSentTabIds.add(tabId);
  sendInitialResizeToHiddenSiblings(tabId, cols, rows);
}

/**
 * 同じタイルの背面タブのうち、まだ一度もresizeを送っていないものへ実測サイズを配る。
 *
 * 背面タブはdisplay:noneでclientWidth/Heightが0になり、ResizeObserverのコールバックも
 * スキップされる（ensureTerminalTabContent参照）。bun側はhandleResizeでの実測cols/rows到達を
 * PTY起動の合図にしている（spawnSessionPending）ため、そのままだとユーザーが
 * そのタブを開くまでPTYが起動せず、レイアウトプリセットのcommandも流れない
 * （背面タブでサーバーを起動するプリセットが動かない）。
 *
 * 同じタイルのタブはジオメトリが同一なので、表示中のタブで測れた値をそのまま使える。
 * 2回目以降は各タブ自身のResizeObserver（再表示時）に任せ、ここでは何もしない
 */
function sendInitialResizeToHiddenSiblings(sourceTabId: TabId, cols: number, rows: number): void {
  const tileId = tileIdOfTab(sourceTabId);
  if (tileId === null) return;
  for (const tabId of tabIdsByTileId.get(tileId) ?? []) {
    if (tabId === sourceTabId || resizeSentTabIds.has(tabId)) continue;
    // ブラウザタブはtermElを持たない（リサイズはElectrobun側が追従する）
    if (!termElByTabId.has(tabId)) continue;
    resizeSentTabIds.add(tabId);
    sendMessage("resize", { tabId, cols, rows, cellWidth, cellHeight });
  }
}

function tileIdOfTab(tabId: TabId): TileId | null {
  for (const [tileId, tabIds] of tabIdsByTileId) {
    if (tabIds.includes(tabId)) return tileId;
  }
  return null;
}

/** ページ単位スクロール（Cmd+Up/Down等）の1ページ分の行数。表示中の行数をそのまま使う */
function visibleRows(tabId: TabId): number {
  const termEl = termElByTabId.get(tabId);
  if (!termEl) return 1;
  return Math.max(1, Math.floor(termEl.clientHeight / cellHeight));
}

// ---- マウスレポート（TUIアプリへのマウス操作転送）----
// アプリがマウストラッキング（DECSET 9/1000/1002/1003）を有効にしている間は、クリック・
// ドラッグ・ホイールをエスケープシーケンスに変換してPTYへ流す（変換自体はbun側のlibghostty-vt）。
// Shift併用時は転送せず、niwaterm側のテキスト選択・スクロールバック閲覧へフォールバックする
// （xterm系・Ghostty等と同じ慣習）
const mouseTrackingByTabId = new Map<TabId, { tracking: boolean; anyMotion: boolean }>();
/** 押下中のDOMボタン番号。ドラッグ中は.termの外へ出ても押し始めたタブへ送り続ける */
const pressedMouseButtons = new Set<number>();
let mouseDragTabId: TabId | null = null;
let pendingMouseMotion: {
  tabId: TabId;
  termEl: HTMLElement;
  button: MouseButton | null;
  event: MouseEvent;
} | null = null;
let mouseMotionFrameRequested = false;

function isMouseTracking(tabId: TabId): boolean {
  return mouseTrackingByTabId.get(tabId)?.tracking === true;
}

/** イベント対象からターミナル(.term)とそのtabIdを引く。タイル・ポップアップの双方に効く */
function findTerminalAt(
  target: EventTarget | null,
): { tabId: TabId; termEl: HTMLDivElement } | null {
  const el = target instanceof HTMLElement ? target.closest<HTMLElement>(".term") : null;
  if (!el) return null;
  for (const [tabId, termEl] of termElByTabId) {
    if (termEl === el) return { tabId, termEl };
  }
  return null;
}

function sendMouseReport(
  tabId: TabId,
  termEl: HTMLElement,
  action: MouseAction,
  button: MouseButton | null,
  e: MouseEvent,
): void {
  const rect = termEl.getBoundingClientRect();
  sendMessage("mouseEvent", {
    tabId,
    event: {
      action,
      button,
      // .termの左上を原点としたピクセル座標。領域外へドラッグした場合は負値・超過値になるが、
      // それも含めてlibghostty-vt側が判断する（ビューポート外の扱いはモード依存のため）
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      mods: mouseModsFromEvent(e),
      anyButtonPressed: pressedMouseButtons.size > 0,
    },
  });
}

/** ドラッグ中に押されているボタンのうち、最初に押されたものを代表として報告する */
function draggingMouseButton(): MouseButton | null {
  for (const button of pressedMouseButtons) {
    const mapped = domMouseButton(button);
    if (mapped) return mapped;
  }
  return null;
}

/** 移動イベントは1フレーム1件へ間引く（同一セル内の重複はbun側でも落とされる） */
function queueMouseMotion(
  tabId: TabId,
  termEl: HTMLElement,
  button: MouseButton | null,
  event: MouseEvent,
): void {
  pendingMouseMotion = { tabId, termEl, button, event };
  if (mouseMotionFrameRequested) return;
  mouseMotionFrameRequested = true;
  requestAnimationFrame(() => {
    mouseMotionFrameRequested = false;
    flushMouseMotion();
  });
}

/** 押下・解放より後に古い移動が届かないよう、送信前に溜まっている分を吐き出す */
function flushMouseMotion(): void {
  const pending = pendingMouseMotion;
  pendingMouseMotion = null;
  if (!pending) return;
  sendMouseReport(pending.tabId, pending.termEl, "motion", pending.button, pending.event);
}

document.addEventListener("mousedown", (e) => {
  if (e.shiftKey) return;
  const hit = findTerminalAt(e.target);
  if (!hit || !isMouseTracking(hit.tabId)) return;
  const button = domMouseButton(e.button);
  if (!button) return;
  // 既定のテキスト選択開始を止める（選択したい場合はShift併用でこの分岐に入らない）。
  // フォーカス移動は別のmousedownリスナー（tileTreeEl / popupEl）が明示的に行うため影響しない
  e.preventDefault();
  flushMouseMotion();
  pressedMouseButtons.add(e.button);
  mouseDragTabId = hit.tabId;
  sendMouseReport(hit.tabId, hit.termEl, "press", button, e);
});

document.addEventListener("mousemove", (e) => {
  if (mouseDragTabId !== null) {
    const termEl = termElByTabId.get(mouseDragTabId);
    if (termEl) queueMouseMotion(mouseDragTabId, termEl, draggingMouseButton(), e);
    return;
  }
  if (e.shiftKey) return;
  const hit = findTerminalAt(e.target);
  // ボタンを押していない間の移動を要求するのはDECSET 1003のみ
  if (!hit || !mouseTrackingByTabId.get(hit.tabId)?.anyMotion) return;
  queueMouseMotion(hit.tabId, hit.termEl, null, e);
});

document.addEventListener("mouseup", (e) => {
  if (mouseDragTabId === null) return;
  if (!pressedMouseButtons.delete(e.button)) return;
  const tabId = mouseDragTabId;
  if (pressedMouseButtons.size === 0) mouseDragTabId = null;
  const button = domMouseButton(e.button);
  const termEl = termElByTabId.get(tabId);
  if (!button || !termEl) return;
  flushMouseMotion();
  sendMouseReport(tabId, termEl, "release", button, e);
});

// マウスレポート中の右クリックはアプリへ渡すので、webview既定のコンテキストメニューは出さない
document.addEventListener("contextmenu", (e) => {
  if (e.shiftKey) return;
  const hit = findTerminalAt(e.target);
  if (!hit || !isMouseTracking(hit.tabId)) return;
  e.preventDefault();
});

// ---- マウスホイール（スクロールバック閲覧 / マウスレポート）----
// トラックパッドの細かいpxイベントを取りこぼさないよう、tabIdごとに端数を蓄積してから
// 1セルに満たない分は次回に持ち越す
const wheelAccumPxByTabId = new Map<TabId, number>();
const wheelAccumPxXByTabId = new Map<TabId, number>();

/** 蓄積したpxから移動セル数を切り出す（端数は次回へ持ち越す） */
function takeWheelCells(
  accumByTabId: Map<TabId, number>,
  tabId: TabId,
  deltaPx: number,
  cellPx: number,
): number {
  const accumulated = (accumByTabId.get(tabId) ?? 0) + deltaPx;
  const cells = Math.trunc(accumulated / cellPx);
  accumByTabId.set(tabId, accumulated - cells * cellPx);
  return cells;
}

/**
 * ホイールの送信先ターミナルを引く。.term上ならそのタブ、タイル内のターミナル外
 * （タブバー等）ならそのタイルのアクティブタブへ送る
 */
function findWheelTarget(
  target: EventTarget | null,
): { tabId: TabId; termEl: HTMLDivElement } | null {
  const hit = findTerminalAt(target);
  if (hit) return hit;
  const tileEl = target instanceof HTMLElement ? target.closest<HTMLElement>(".tile") : null;
  const tileId = tileEl?.dataset["tileId"];
  const tabId = tileId ? activeTabByTile.get(tileId) : undefined;
  const termEl = tabId ? termElByTabId.get(tabId) : undefined;
  // ターミナルタブのみ対象（ブラウザタブはOOPIF自身のネイティブスクロールに任せる）
  if (!tabId || !termEl) return null;
  return { tabId, termEl };
}

// タイル内のターミナルとポップアップの双方に効かせるため、documentレベルで委譲する
document.addEventListener(
  "wheel",
  (e) => {
    const hit = findWheelTarget(e.target);
    if (!hit) return;
    const { tabId, termEl } = hit;
    e.preventDefault();
    // deltaMode: 0=pixel, 1=line, 2=page（DOM_DELTA_*）。line/pageは行高/表示行数で近似する
    const deltaPxY =
      e.deltaMode === 1
        ? e.deltaY * cellHeight
        : e.deltaMode === 2
          ? e.deltaY * visibleRows(tabId) * cellHeight
          : e.deltaY;
    const lines = takeWheelCells(wheelAccumPxByTabId, tabId, deltaPxY, cellHeight);

    if (isMouseTracking(tabId) && !e.shiftKey) {
      // マウスレポート中はスクロールバックを動かさず、ホイールをボタン押下としてアプリへ送る
      const deltaPxX = e.deltaMode === 0 ? e.deltaX : e.deltaX * cellWidth;
      const cols = takeWheelCells(wheelAccumPxXByTabId, tabId, deltaPxX, cellWidth);
      for (const [cells, axis] of [
        [lines, "vertical"],
        [cols, "horizontal"],
      ] as const) {
        const report = wheelReport(cells, axis);
        if (!report) continue;
        for (let i = 0; i < report.count; i++) {
          sendMouseReport(tabId, termEl, "press", report.button, e);
        }
      }
      return;
    }
    if (lines !== 0) sendMessage("scroll", { tabId, deltaLines: lines });
  },
  { passive: false },
);

// ---- 境界ドラッグでのリサイズ ----
const MIN_TILE_PX = 80;

function attachDividerDrag(dividerEl: HTMLDivElement, splitId: TileId): void {
  dividerEl.addEventListener("pointerdown", (e) => {
    const splitEl = splitElBySplitId.get(splitId);
    if (!splitEl) return;
    // divider自体はフォーカス不可な要素だが、既定動作でフォーカスがbodyへ移ってしまうため
    // 明示的にpreventDefaultしてimeElへのフォーカスを維持する
    e.preventDefault();
    dividerEl.setPointerCapture(e.pointerId);
    const direction = splitEl.dataset["direction"] === "column" ? "column" : "row";
    const rect = splitEl.getBoundingClientRect();
    const total = direction === "row" ? rect.width : rect.height;
    draggingSplitId = splitId;

    const ratioFromEvent = (ev: PointerEvent): number => {
      const pos = direction === "row" ? ev.clientX - rect.left : ev.clientY - rect.top;
      return Math.min(1 - MIN_TILE_PX / total, Math.max(MIN_TILE_PX / total, pos / total));
    };

    const onMove = (ev: PointerEvent): void => {
      const ratio = ratioFromEvent(ev);
      const firstEl = splitEl.children[0] as HTMLElement;
      const secondEl = splitEl.children[2] as HTMLElement;
      firstEl.style.flex = `${ratio} 0 0%`;
      secondEl.style.flex = `${1 - ratio} 0 0%`;
    };

    const onUp = (ev: PointerEvent): void => {
      dividerEl.removeEventListener("pointermove", onMove);
      dividerEl.removeEventListener("pointerup", onUp);
      const ratio = ratioFromEvent(ev);
      draggingSplitId = null;
      pendingSplitRatio = { splitId, ratio };
      sendMessage("resizeSplit", { splitId, ratio });
      imeEl.focus({ preventScroll: true });
      // ドラッグ中はResizeObserver経由のresize送信を抑制していたため、確定サイズで送り直す
      // （非表示タブはclientWidth/Heightが0になるため、表示中のタブだけを対象にする）
      for (const tabId of activeTabByTile.values()) {
        sendResize(tabId);
      }
    };

    dividerEl.addEventListener("pointermove", onMove);
    dividerEl.addEventListener("pointerup", onUp);
  });
}

/** サイドバーと#screen間のdivider。タイル分割と異なりbunのtreeに属さないローカルUI状態
 * のため、resizeSplitのようなRPC送信はせずlocalStorageへ直接保存する */
function attachSidebarDividerDrag(): void {
  sidebarDividerEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    sidebarDividerEl.setPointerCapture(e.pointerId);
    draggingSidebar = true;
    const startX = e.clientX;
    const startWidth = sidebarEl.getBoundingClientRect().width;

    const widthFromEvent = (ev: PointerEvent): number => {
      const total = document.body.clientWidth;
      const maxWidth = Math.max(
        MIN_SIDEBAR_WIDTH_PX,
        Math.min(total * MAX_SIDEBAR_WIDTH_RATIO, total - MIN_TILE_PX),
      );
      const rawWidth = startWidth + (ev.clientX - startX);
      return Math.min(maxWidth, Math.max(MIN_SIDEBAR_WIDTH_PX, rawWidth));
    };

    const onMove = (ev: PointerEvent): void => {
      applySidebarWidth(widthFromEvent(ev));
    };

    const onUp = (ev: PointerEvent): void => {
      sidebarDividerEl.removeEventListener("pointermove", onMove);
      sidebarDividerEl.removeEventListener("pointerup", onUp);
      draggingSidebar = false;
      sidebarWidth = widthFromEvent(ev);
      applySidebarWidth(sidebarWidth);
      saveSidebarWidth(sidebarWidth);
      imeEl.focus({ preventScroll: true });
      // ドラッグ中はResizeObserver経由のresize送信を抑制していたため、確定サイズで送り直す
      for (const tabId of activeTabByTile.values()) {
        sendResize(tabId);
      }
    };

    sidebarDividerEl.addEventListener("pointermove", onMove);
    sidebarDividerEl.addEventListener("pointerup", onUp);
  });
}

// ---- キー入力 → タイル操作 or PTYバイト列 ----
document.addEventListener("keydown", (e) => {
  // IME変換中のキーはcompositionイベント側で処理する（keyCode 229はWebKitのIME通知）。
  // ただしmacOSのOption+英数字はデッドキー（Option+N/E/U/I等）もkeyCode 229で通知されるため、
  // Altを伴うkeydownはこのガードから除外する（除外しないとalt+nのようなdirectバインドが
  // 一度も発火しない）。実際に変換中かどうかはisComposingで判定できるのでそちらは残す
  if (e.isComposing || (e.keyCode === 229 && !e.altKey)) return;
  // ブラウザタブのURL入力欄編集中は、そのままネイティブのテキスト編集に任せる
  // （PTYへのバイト送信やタイル操作キーバインドに奪われないようにする）
  if (e.target instanceof HTMLInputElement) return;
  // 確認ダイアログ表示中はConfirmDialog内のonKeyDown（y/n/Esc）に処理を委ね、PTYへの入力や
  // 他のキーバインド発火を止める（inputEl判定と違いDialogContentはdiv要素のため上のガードでは拾えない）
  if (confirmDialogOpen) return;
  // 入力ダイアログ表示中も同様。入力欄自体は上のHTMLInputElement判定で拾えるが、
  // ボタンへフォーカスが移った状態のキー入力はここで止める
  if (promptDialogOpen) return;

  const result = keybindResolver.handleKeydown(e);
  if (result.kind === "command") {
    e.preventDefault();
    handleTileCommand(result.command);
    return;
  }
  if (result.kind === "consumed") {
    // prefix入力後の2打目キー待ち・Escapeキャンセル・未割当キーの破棄など。
    // PTYには何も送らない（result.kind === "passthrough"の場合のみ下へ進む）
    e.preventDefault();
    return;
  }

  if (!currentTabId) return;

  // コピーモード中は、キーバインドに該当しなかったキーをPTYではなくbun側のコピーモードへ回す。
  // 修飾キー単体は無視する（Shiftを押した瞬間にコピーモードが反応してしまわないように）
  if (copyModeTabIds.has(currentTabId)) {
    // 検索文字列の入力中のペーストだけはブラウザのpasteイベントへ通す（下のpasteリスナが検索文字列へ回す）
    if (
      copyModeSearchTabIds.has(currentTabId) &&
      (e.metaKey || e.ctrlKey) &&
      e.key.toLowerCase() === "v"
    ) {
      return;
    }
    e.preventDefault();
    if (!MODIFIER_ONLY_KEYS.has(e.key)) {
      sendMessage("copyModeKey", { tabId: currentTabId, key: e.key, ctrl: e.ctrlKey });
    }
    return;
  }

  const bytes = keyToBytes(e);
  if (bytes !== null) {
    e.preventDefault();
    sendMessage("input", { tabId: currentTabId, data: bytes });
  }
});

// 修飾キー単体のkeydown（Shiftを押しただけでもe.key === "Shift"で発火する）
const MODIFIER_ONLY_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

// キーバインド1回分のフォントサイズ増減量（px）。上下限のクランプ・実際の適用はbun側が担う
const FONT_SIZE_STEP = 1;

function handleTileCommand(cmd: TileCommand): void {
  // サイドバー開閉・ポップアップ開閉はbun側の状態を必要としないため、フォーカス中タイル無しでも動作させる
  if (cmd.type === "toggleSidebar") {
    toggleSidebar();
    return;
  }
  if (cmd.type === "togglePopup") {
    togglePopup();
    return;
  }
  if (cmd.type === "commandPalette") {
    openCommandPalette();
    return;
  }
  // Board名の変更はフォーカス中タイルではなくアクティブBoardが対象なので、
  // focusedTileIdのガードより手前で処理する
  if (cmd.type === "renameBoard") {
    openRenameActiveBoardDialog();
    return;
  }
  if (cmd.type === "increaseFontSize") {
    sendMessage("zoomFontSize", { delta: FONT_SIZE_STEP });
    return;
  }
  if (cmd.type === "decreaseFontSize") {
    sendMessage("zoomFontSize", { delta: -FONT_SIZE_STEP });
    return;
  }
  if (cmd.type === "resetFontSize") {
    sendMessage("resetFontSizeZoom");
    return;
  }
  if (cmd.type === "reloadConfig") {
    sendMessage("reloadConfig");
    return;
  }
  // niwa.keybindの関数ハンドラ。実際の処理はbun側（niwa-api.ts）で行うため、
  // ここではRPCで実行を依頼するだけでよい（focusedTileIdの有無に依存しない）
  if (cmd.type === "custom") {
    sendMessage("runKeybindHandler", { handlerId: cmd.handlerId });
    return;
  }
  if (!focusedTileId) return;
  switch (cmd.type) {
    case "split":
      sendMessage("splitTile", { tileId: focusedTileId, orientation: cmd.orientation });
      break;
    case "close":
      if (!currentTabId) return;
      sendMessage("closeTab", { tileId: focusedTileId, tabId: currentTabId });
      break;
    case "focus":
      sendMessage("focusDirection", { direction: cmd.direction });
      break;
    case "resize":
      sendMessage("resizeTileInDirection", { direction: cmd.direction });
      break;
    case "toggleZoom":
      sendMessage("toggleZoomTile", { tileId: focusedTileId });
      break;
    case "newTab":
      sendMessage("newTab", { tileId: focusedTileId });
      break;
    case "newBrowserTab":
      sendMessage("newBrowserTab", { tileId: focusedTileId });
      break;
    case "newCustomViewTab":
      sendMessage("newCustomViewTab", { tileId: focusedTileId });
      break;
    case "restartTab": {
      if (!currentTabId) return;
      const tabId = currentTabId;
      openConfirmDialog("タブを再起動しますか？", "実行中のプロセスは強制終了されます。", () => {
        sendMessage("restartTab", { tabId });
      });
      break;
    }
    case "cycleTab": {
      if (!lastLayout) return;
      const leaf = findNode(lastLayout, focusedTileId);
      if (!leaf || leaf.kind !== "leaf" || leaf.tabIds.length < 2) return;
      const tabId = nextTabId(leaf, cmd.delta);
      setActiveTabLocally(focusedTileId, tabId);
      currentTabId = tabId;
      sendMessage("switchTab", { tileId: focusedTileId, tabId });
      break;
    }
    case "newWorkspace":
      sendMessage("newWorkspace");
      break;
    case "switchBoard": {
      if (!activeBoardId || boardIds.length < 2) return;
      const index = boardIds.indexOf(activeBoardId);
      const len = boardIds.length;
      const boardId = boardIds[(index + cmd.delta + len) % len];
      sendMessage("switchBoard", { boardId });
      break;
    }
    case "switchWorkspace": {
      if (!activeWorkspaceId || workspaceIds.length < 2) return;
      const index = workspaceIds.indexOf(activeWorkspaceId);
      const len = workspaceIds.length;
      const workspaceId = workspaceIds[(index + cmd.delta + len) % len];
      sendMessage("switchWorkspace", { workspaceId });
      break;
    }
    case "moveBoard": {
      if (!activeBoardId || boardIds.length < 2) return;
      const index = boardIds.indexOf(activeBoardId);
      if (index === -1) return;
      // switchBoardと違い端では巡回しない（並び替えは端で止まる方が結果を予測しやすい）
      const toIndex = index + cmd.delta;
      if (toIndex < 0 || toIndex >= boardIds.length) return;
      sendMessage("moveBoard", { boardId: activeBoardId, toIndex });
      break;
    }
    case "moveWorkspace": {
      if (!activeWorkspaceId || workspaceIds.length < 2) return;
      const index = workspaceIds.indexOf(activeWorkspaceId);
      if (index === -1) return;
      // switchWorkspaceと違い端では巡回しない（並び替えは端で止まる方が結果を予測しやすい）
      const toIndex = index + cmd.delta;
      if (toIndex < 0 || toIndex >= workspaceIds.length) return;
      sendMessage("moveWorkspace", { workspaceId: activeWorkspaceId, toIndex });
      break;
    }
    case "copySelection": {
      const text = window.getSelection()?.toString();
      if (text) sendMessage("copySelection", { text });
      break;
    }
    case "copyMode":
      if (!currentTabId) return;
      sendMessage("enterCopyMode", { tabId: currentTabId });
      break;
    case "pasteClipboard":
      if (!currentTabId) return;
      sendMessage("pasteFromClipboard", { tabId: currentTabId });
      break;
    case "scrollPage": {
      if (!currentTabId) return;
      const rows = visibleRows(currentTabId);
      sendMessage("scroll", {
        tabId: currentTabId,
        deltaLines: cmd.direction === "up" ? -rows : rows,
      });
      break;
    }
    case "scrollToEdge":
      if (!currentTabId) return;
      sendMessage(cmd.edge === "top" ? "scrollToTop" : "scrollToBottom", { tabId: currentTabId });
      break;
  }
}

// ---- IME（composition）----
let composing = false;

/**
 * 未確定文字列の表示とimeElに許す幅の上限（カーソル位置からタイルの右端まで）。
 *
 * タイルをはみ出して広げると、はみ出したキャレットを見せようとしたブラウザがbodyごと
 * 横スクロールし、サイドバーやタイル全体が左へずれる（Chromium実測で、画面外へ741px
 * 広げるとbody.scrollLeftが741になる）。代わりにタイル幅を超えた分の未確定文字列は
 * 表示されず、候補ウィンドウの位置もずれる（タイルを広げるか早めに確定するしかない）。
 */
function imeMaxWidth(): number {
  const termEl = currentTabId ? termElByTabId.get(currentTabId) : undefined;
  const rightEdge = (termEl ?? screenEl).getBoundingClientRect().right;
  return Math.max(cellWidth, Math.floor(rightEdge - imeEl.getBoundingClientRect().left));
}

/**
 * imeElの幅を未確定文字列に合わせる。
 *
 * imeElが未確定文字列より狭いままだとtextareaの中身が横スクロールし、ブラウザがOSのIMEへ
 * 通知する未確定文字の矩形が1文字ぶんずつ左へずれていく（Chromium実測で13px/文字。表示は
 * 自前のcompositionElなのでずれるのは候補ウィンドウだけ）。幅を実際の未確定文字列に合わせて
 * 横スクロールを起こさせないことで、候補ウィンドウをカーソル位置へ留める。
 */
function syncImeWidth(): void {
  const maxWidth = imeMaxWidth();
  compositionEl.style.maxWidth = `${maxWidth}px`;
  const width = Math.ceil(compositionEl.getBoundingClientRect().width) + cellWidth;
  imeEl.style.width = `${Math.max(2, Math.min(width, maxWidth))}px`;
}

imeEl.addEventListener("compositionstart", () => {
  composing = true;
  compositionEl.textContent = "";
  compositionEl.style.display = "block";
  syncImeWidth();
});

imeEl.addEventListener("compositionupdate", (e) => {
  compositionEl.textContent = e.data;
  syncImeWidth();
});

imeEl.addEventListener("compositionend", (e) => {
  composing = false;
  compositionEl.style.display = "none";
  compositionEl.textContent = "";
  compositionEl.style.maxWidth = "";
  imeEl.style.width = "";
  imeEl.value = "";
  if (e.data && currentTabId) {
    if (sendTextToCopyModeSearch(currentTabId, e.data)) return;
    sendMessage("input", { tabId: currentTabId, data: e.data });
  }
});

/**
 * コピーモードの検索文字列を入力中なら、確定した文字列を1文字ずつコピーモードへ送る（送ったらtrue）。
 * bun側のコピーモードはキー単位でしか受け取らないため、IME確定・ペーストもここでキー列へ均す
 */
function sendTextToCopyModeSearch(tabId: TabId, text: string): boolean {
  if (!copyModeSearchTabIds.has(tabId)) return false;
  for (const ch of text) {
    sendMessage("copyModeKey", { tabId, key: ch, ctrl: false });
  }
  return true;
}

// composition外でtextareaに入った入力の保険（dead key等）。二重送信はcomposingフラグで防ぐ
imeEl.addEventListener("input", (e) => {
  if (composing || (e as InputEvent).isComposing) return;
  if (imeEl.value && currentTabId) {
    sendMessage("input", { tabId: currentTabId, data: imeEl.value });
    imeEl.value = "";
  }
});

// ---- ペースト（Cmd+V）----
document.addEventListener("paste", (e) => {
  // ブラウザタブのURL入力欄ではネイティブのペーストに任せる
  if (e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  const text = e.clipboardData?.getData("text/plain");
  if (!text || !currentTabId) return;
  if (sendTextToCopyModeSearch(currentTabId, text)) return;
  sendMessage("paste", { tabId: currentTabId, data: text });
});

// ---- フォーカスルーティング（クリックされたタイル/タブへ切り替える）----
function focusTileLocally(tileId: TileId): void {
  if (tileId === focusedTileId) return;
  focusedTileId = tileId;
  currentTabId = activeTabByTile.get(tileId) ?? null;
  updateFocusHighlight();
  sendMessage("focusTile", { tileId });
}

/** アクティブワークスペース内でのタブ切替をローカル即時反映＋RPC送信する（タブボタン・サイドバー共通） */
function switchToTab(tileId: TileId, tabId: TabId): void {
  setActiveTabLocally(tileId, tabId);
  focusTileLocally(tileId);
  currentTabId = tabId;
  sendMessage("switchTab", { tileId, tabId });
}

/**
 * サイドバーのポップアップ行クリック。非アクティブワークスペースなら先に切り替え、
 * 最小化（非表示）中なら再表示する。既に表示中ならフォーカスを移すだけ
 */
function activateSidebarPopup(workspaceId: WorkspaceId): void {
  if (workspaceId !== activeWorkspaceId) {
    sendMessage("switchWorkspace", { workspaceId });
  }
  const entry = lastWorkspaces.find((w) => w.workspaceId === workspaceId);
  const popup = entry?.popup;
  if (popup && !popup.visible) {
    sendMessage("togglePopupVisibility");
  }
  imeEl.focus({ preventScroll: true });
}

tileTreeEl.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  const tileEl = target.closest<HTMLElement>(".tile");
  const tileId = tileEl?.dataset["tileId"];
  if (!tileId) return;

  if (target.closest<HTMLElement>(".browser-toolbar")) {
    // URL入力欄クリック時にimeElへフォーカスを奪うと編集できなくなるため、
    // フォーカスハイライトの更新だけ行いネイティブのフォーカス遷移に任せる
    focusTileLocally(tileId);
    return;
  }

  focusTileLocally(tileId);
  // テキスト選択（コピー用ドラッグ）を妨げないようフォーカスだけ移す
  imeEl.focus({ preventScroll: true });
});

// Chromiumはmousedownの既定動作で「クリック先の最も近いフォーカス可能な祖先」へフォーカスを移し、
// 見つからなければフォーカスを外す。.termはフォーカス不能なため、mousedownリスナー内で
// imeEl.focus()しても既定動作に上書きされ、document.activeElementはbodyになる。
// documentレベルのkeydownは動くのでASCIIは打てるが、編集可能要素にフォーカスが無いと
// ChromiumはOSのIMEを無効にするため日本語入力だけができなくなる。
// 既定動作が終わったmouseupで入れ直す。ドラッグ選択中（選択が残っている）は選択を壊すため触らない
tileTreeEl.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  imeEl.focus({ preventScroll: true });
});

// ---- OSC 8ハイパーリンク（フォーマッタがHTML出力時に <a href> として埋め込む）----
// documentレベルで委譲し、タイル・popup両方のターミナル出力内リンクをまとめて扱う
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const anchor = target.closest<HTMLAnchorElement>(".term a[href]");
  if (!anchor) return;
  // ドラッグでのテキスト選択の終端クリックでは開かない（選択解除も兼ねて素通りさせる）
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  e.preventDefault();
  sendMessage("openLink", { url: anchor.href });
  imeEl.focus({ preventScroll: true });
});

// ---- タブD&D移動（別タイルへドロップしたら該当タイルへ移動する）----
let dragOverTileEl: HTMLElement | null = null;

function clearTabDragOver(): void {
  dragOverTileEl?.classList.remove("drag-over");
  dragOverTileEl = null;
}

tileTreeEl.addEventListener("dragover", (e) => {
  if (!e.dataTransfer?.types.includes(TAB_DRAG_MIME)) return;
  const tileEl = (e.target as HTMLElement).closest<HTMLElement>(".tile");
  if (!tileEl) return;
  // ブラウザ既定動作（drop不可）を上書きし、このタイル上でのdropを許可する
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  if (dragOverTileEl !== tileEl) {
    clearTabDragOver();
    tileEl.classList.add("drag-over");
    dragOverTileEl = tileEl;
  }
});
tileTreeEl.addEventListener("dragleave", (e) => {
  // tileTreeEl自体から出た場合のみ解除する（子要素間の行き来ではdragOverTileElを維持する）
  if (dragOverTileEl && !tileTreeEl.contains(e.relatedTarget as Node)) clearTabDragOver();
});
tileTreeEl.addEventListener("drop", (e) => {
  const raw = e.dataTransfer?.getData(TAB_DRAG_MIME);
  const tileEl = (e.target as HTMLElement).closest<HTMLElement>(".tile");
  clearTabDragOver();
  if (!raw || !tileEl) return;
  e.preventDefault();
  const toTileId = tileEl.dataset["tileId"];
  if (!toTileId) return;
  let payload: TabDragPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (payload.fromTileId === toTileId) return;
  focusTileLocally(toTileId);
  sendMessage("moveTab", { fromTileId: payload.fromTileId, tabId: payload.tabId, toTileId });
  imeEl.focus({ preventScroll: true });
});
// ドロップに至らずドラッグが終了した場合（Escapeでのキャンセル等）もハイライトを解除する
document.addEventListener("dragend", clearTabDragOver);

window.addEventListener("focus", () => {
  // URL入力欄編集中に他アプリへ切替→復帰すると、windowのfocusイベントで
  // imeElへフォーカスを奪われ編集が中断してしまうため、その場合はスキップする
  if (document.activeElement instanceof HTMLInputElement) return;
  imeEl.focus({ preventScroll: true });
});
// prefix入力後の2打目キー待ち中にウィンドウのフォーカスが外れると、復帰後の最初のキー入力が
// 意図せず2打目キーとして解釈されてしまうため、フォーカス喪失時に待ち状態を解除する
window.addEventListener("blur", () => {
  keybindResolver.reset();
});
imeEl.focus({ preventScroll: true });

// ---- 起動 ----
setupPalette();
applyAppearance(defaultAppearance);
applySidebarWidth(sidebarWidth);
attachSidebarDividerDrag();
applySidebarVisibility();
measureCell();
renderCommandPalette();
sendMessage("ready");

// Electrobunのwebview→bun RPCは`ws://127.0.0.1:<port>/socket`のWebSocketで飛び、そのポートは
// ネイティブ層(ElectrobunCore.dll)が50000から上へ空きを探して決める。ところがWindowsは既に
// listen中のポートへの重複bindが成功してしまうため、niwaterm-wipとniwaterm-dailyを同時に
// 起動すると、後発側は「誰も接続してこない死んだlistener」を掴み、そのwebviewは先発側の
// アプリのbunプロセスへ繋がってしまう。readyもresizeも別インスタンスに吸われて消えるため、
// 初回renderが来ない→.term要素が生成されない→ResizeObserverが発火しない→board.tsの
// pendingSpawnが永久に消化されず、ターミナルが1文字も描画されない状態になる。
// ポート番号をずらす方向は原理的に効かない（何番へ押し出しても同じ重複bindが起きる）ので、
// 一定時間bunからの応答が無ければソケットを閉じ、Electroviewが持つプロセス内の
// フォールバック経路(__electrobunHostBridge = WebView2のhostObject)へ逃がす。単独起動なら
// 応答が即座に来てこのタイマーは空振りするため、通常経路の性能には影響しない。
// 詳細: docs/known-issues/electrobun-rpc-socket-port-collision-on-windows.md
const HOST_RPC_FALLBACK_TIMEOUT_MS = 1500;
setTimeout(() => {
  if (hostRpcReplyReceived) return;
  // close()した時点でreadyStateがOPENでもCONNECTINGでもなくなり、以降のsendは
  // Electroview側で自動的にネイティブブリッジ経由になる
  electroview.hostSocket?.close();
  sendMessage("log", { msg: "host rpc socket had no reply; fell back to the native bridge" });
  sendMessage("ready");
}, HOST_RPC_FALLBACK_TIMEOUT_MS);
window.addEventListener("error", (e) => {
  sendMessage("log", { msg: `error: ${e.message}` });
});
