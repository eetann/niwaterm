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
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NiwaRPC } from "../bun/index";
import type { TabRenderState } from "../bun/workspace";
import { findNode, nextTabId, type TabId, type TileId, type TileNode } from "../bun/tile-layout";
import type { AppRenderState, WorkspaceId, WorkspaceListEntry } from "../bun/workspace-manager";
import { buildExecBrowserJsScript } from "./browser-js-bridge";
import { keyToBytes } from "./key-to-bytes";
import { normalizeUrl } from "./normalize-url";
import { BrowserToolbar } from "./react/browser-toolbar";
import { buildSidebarWorkspaceItems } from "./react/sidebar-props";
import { SidebarSwitcher } from "./react/sidebar-switcher";
import { SidebarWorkspaceList } from "./react/sidebar-workspace-list";
import { TAB_DRAG_MIME, TileTabBar, type TabDragPayload } from "./react/tile-tab-bar";
import { resolveTileCommand, type TileCommand } from "./tile-keybindings";
import { isWideChar } from "./wide-char";

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

// ---- タイル/タブごとのDOM要素・状態管理 ----
const tileElByTileId = new Map<TileId, HTMLElement>();
const tabBarElByTileId = new Map<TileId, HTMLDivElement>();
const tabBarReactRootByTileId = new Map<TileId, Root>();
const tabContentElByTabId = new Map<TabId, HTMLDivElement>();
const termElByTabId = new Map<TabId, HTMLDivElement>();
const cursorElByTabId = new Map<TabId, HTMLDivElement>();
const browserElByTabId = new Map<TabId, WebviewTagElement>();
const browserToolbarRootByTabId = new Map<TabId, Root>();
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
const splitElBySplitId = new Map<TileId, HTMLDivElement>();
const dividerElBySplitId = new Map<TileId, HTMLDivElement>();

// ---- サイドバー: 起動時に固定のReact root（closeやopen等に応じて中身だけ差し替える）----
const sidebarSwitcherRoot = createRoot(sidebarSwitcherEl);
const sidebarWorkspaceListRoot = createRoot(sidebarListEl);

// ---- サイドバーのユーザー定義HTML UI（customView）----
let customViewWebviewEl: WebviewTagElement | null = null;
let customViewUrl: string | null = null;
let customViewName: string | null = null;
let sidebarShowingCustom = false;

let focusedTileId: TileId | null = null;
// フォーカス中タイルのactiveTabId（キー入力・ペーストの送信先）
let currentTabId: TabId | null = null;
// 直近のrender()で受け取ったlayout。cycleTab等、キー操作時にDOM待ちせず参照するために保持する
let lastLayout: TileNode | null = null;
// 直近のrender()で受け取ったアクティブワークスペースのタブ名。タブバーのラベル表示に使う
let lastTabNames: Record<TabId, string> = {};
// ワークスペース切替（Cmd+Option+]/[）の次/前の対象を解決するために保持する
let activeWorkspaceId: WorkspaceId | null = null;
let workspaceIds: WorkspaceId[] = [];
// ドラッグ中のsplitId。reconcile時にflexスタイルを上書きしないようにするためのガード
let draggingSplitId: TileId | null = null;
// ドラッグ確定直後、bun側のtreeがまだ古いratioのままのrenderが届く可能性があるため、
// bunのratioが確定値に追いつくまでローカルのratioを維持する（それまでの間、古いratioで
// flexスタイルが巻き戻されてResizeObserverが誤ったcolsを送ってしまうのを防ぐ）
let pendingSplitRatio: { splitId: TileId; ratio: number } | null = null;
// bun側からのkeybindingsメッセージ到達前はデフォルトキーバインドにフォールバックする。
// プラットフォーム別デフォルト（Windowsはctrl+shift系）の解決はbun側が行うため、
// ここではmacOS向けの値になる。configメッセージ到達時に正しいテーブルへ差し替わる
let compiledKeybindings = compileKeybindings(defaultKeybindings);
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
  // フォントサイズ変更でcellWidth/cellHeightが変わりうるため、表示中の全タブへ再計測・再送する
  for (const tabId of activeTabByTile.values()) {
    sendResize(tabId);
  }
}

// ---- RPC ----
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
        activeWorkspaceId = p.activeWorkspaceId;
        workspaceIds = p.workspaceIds;
        lastLayout = p.workspace.layout;
        lastTabNames = p.workspace.tabNames;
        renderLayout(p.workspace.layout, p.workspace.tabs);
        lastWorkspaces = p.workspaces;
        if (sidebarOpen) renderSidebar(lastWorkspaces, activeWorkspaceId);
        focusedTileId = p.workspace.focusedTileId;
        currentTabId = (focusedTileId && activeTabByTile.get(focusedTileId)) ?? null;
        updateFocusHighlight();
        for (const tabId of Object.keys(p.workspace.tabs)) {
          const renderState = p.workspace.tabs[tabId];
          if (!renderState || renderState.kind !== "terminal") continue;
          const termEl = termElByTabId.get(tabId);
          if (!termEl) continue;
          termEl.innerHTML = renderState.html;
          fixWideChars(termEl);
          // スクロールバック閲覧中はhtmlがその位置の内容になり、cursorX/Yは
          // アクティブエリア（最新行）側の座標のまま非表示にする（対応する画面外のため）
          updateCursorForTab(
            tabId,
            renderState.cursorX,
            renderState.cursorY,
            renderState.cursorVisible && renderState.viewportPinned,
          );
          updateScrollIndicator(tabId, renderState.viewportPinned);
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
        compiledKeybindings = compileKeybindings(keybindings);
        applyAppearance(appearance);
        applyCustomView(customView);
        shellProfiles = profiles;
        // configの到達タイミングは既存タイルの最終renderより後になりうるため、
        // ドロップダウンの中身（shellProfiles）を最新化するために明示的に再renderする
        for (const tileId of tabBarReactRootByTileId.keys()) renderTileTabBar(tileId);
      },
    },
  },
});

new Electrobun.Electroview({ rpc });

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

// ---- 全角文字の幅補正 ----
/**
 * テキストノード中の全角文字を <span class="wide"> でラップして2セル幅に強制する。
 * フォーマッタ出力はプレーンテキストなので、フォント任せだと桁がズレるため。
 */
function fixWideChars(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node as Text).data;
    for (const ch of text) {
      if (isWideChar(ch.codePointAt(0) ?? 0)) {
        targets.push(node as Text);
        break;
      }
    }
  }
  for (const node of targets) {
    const frag = document.createDocumentFragment();
    let narrow = "";
    for (const ch of node.data) {
      if (isWideChar(ch.codePointAt(0) ?? 0)) {
        if (narrow) {
          frag.appendChild(document.createTextNode(narrow));
          narrow = "";
        }
        const span = document.createElement("span");
        span.className = "wide";
        span.textContent = ch;
        frag.appendChild(span);
      } else {
        narrow += ch;
      }
    }
    if (narrow) frag.appendChild(document.createTextNode(narrow));
    node.parentNode?.replaceChild(frag, node);
  }
}

// ---- タイル木構造 → DOM reconciliation ----
function renderLayout(layout: TileNode, tabs: Record<TabId, TabRenderState>): void {
  const seenTabIds = new Set<TabId>();
  const seenSplitIds = new Set<TileId>();
  const seenTileIds = new Set<TileId>();
  const rootEl = reconcile(layout, tabs, seenTabIds, seenSplitIds, seenTileIds);
  if (rootEl.parentElement !== tileTreeEl) {
    tileTreeEl.appendChild(rootEl);
  }
  gcStale(seenTabIds, seenSplitIds, seenTileIds);
}

function reconcile(
  node: TileNode,
  tabs: Record<TabId, TabRenderState>,
  seenTabIds: Set<TabId>,
  seenSplitIds: Set<TileId>,
  seenTileIds: Set<TileId>,
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
      tabBarReactRootByTileId.set(node.id, createRoot(tabBarEl));
    } else {
      tabBarEl = tabBarElByTileId.get(node.id) as HTMLDivElement;
      tileContentEl = tileEl.querySelector(".tile-content") as HTMLDivElement;
    }
    tileEl.dataset["tileId"] = node.id;

    node.tabIds.forEach((tabId) => {
      seenTabIds.add(tabId);
      const renderState = tabs[tabId];
      if (renderState) ensureTabContent(tabId, tileContentEl, renderState);
      setTabVisible(tabId, tabId === node.activeTabId);
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

  const firstEl = reconcile(node.first, tabs, seenTabIds, seenSplitIds, seenTileIds);
  const dividerEl = getOrCreateDivider(node.id);
  const secondEl = reconcile(node.second, tabs, seenTabIds, seenSplitIds, seenTileIds);

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
    const ratio = pendingSplitRatio?.splitId === node.id ? pendingSplitRatio.ratio : node.ratio;
    firstEl.style.flex = `${ratio} 0 0%`;
    secondEl.style.flex = `${1 - ratio} 0 0%`;
  }

  for (const child of [firstEl, dividerEl, secondEl]) {
    splitEl.appendChild(child);
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
  tabContentElByTabId.set(tabId, tabContentEl);
  termElByTabId.set(tabId, termEl);
  cursorElByTabId.set(tabId, cursorEl);
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

  const toolbarRoot = createRoot(toolbarEl);
  browserToolbarRootByTabId.set(tabId, toolbarRoot);
  toolbarRoot.render(
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
  browserElByTabId.get(tabId)?.toggleHidden(!visible);
}

/** クリック/キー操作でのタブ切替をローカルへ即時反映する（次のrenderを待たず入力送信先を切り替えるため） */
function setActiveTabLocally(tileId: TileId, tabId: TabId): void {
  const previousActive = activeTabByTile.get(tileId);
  if (previousActive === tabId) return;
  activeTabByTile.set(tileId, tabId);
  if (previousActive) setTabVisible(previousActive, false);
  setTabVisible(tabId, true);
  renderTileTabBar(tileId);
}

/** tileIdのタブバーReact rootへ最新propsで再renderする。lastLayoutから対象leafを都度引く */
function renderTileTabBar(tileId: TileId): void {
  const root = tabBarReactRootByTileId.get(tileId);
  if (!root || !lastLayout) return;
  const leaf = findNode(lastLayout, tileId);
  if (!leaf || leaf.kind !== "leaf") return;
  root.render(
    createElement(TileTabBar, {
      tileId,
      tabs: leaf.tabIds.map((tabId, index) => ({
        tabId,
        label: lastTabNames[tabId] || String(index + 1),
      })),
      activeTabId: leaf.activeTabId,
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
    tabContentElByTabId.get(tabId)?.remove();
    tabContentElByTabId.delete(tabId);
    termElByTabId.delete(tabId);
    cursorElByTabId.delete(tabId);
    wheelAccumPxByTabId.delete(tabId);
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
}

// ---- サイドバー: ワークスペース＋タブのフラット一覧 → DOM reconciliation ----
// タイル木のreconcileとは別系統のMap・gcを使う（全ワークスペースを描画するため）
function renderSidebar(
  workspaces: WorkspaceListEntry[],
  currentActiveWorkspaceId: WorkspaceId | null,
): void {
  sidebarWorkspaceListRoot.render(
    createElement(SidebarWorkspaceList, {
      workspaces: buildSidebarWorkspaceItems(workspaces, currentActiveWorkspaceId),
      onSelectWorkspaceHeader: activateSidebarWorkspace,
      onSelectTab: activateSidebarTab,
      onRenameTab: renameSidebarTab,
      onRenameTile: renameSidebarTile,
      onRenameWorkspace: renameSidebarWorkspace,
    }),
  );
}

/** サイドバーのワークスペース見出しクリック。既にアクティブなワークスペースなら何もしない */
function activateSidebarWorkspace(workspaceId: WorkspaceId): void {
  if (workspaceId === activeWorkspaceId) return;
  sendMessage("switchWorkspace", { workspaceId });
  imeEl.focus({ preventScroll: true });
}

/** サイドバーからのタブ名変更。空文字列を送るとbun側でデフォルトの連番ラベルへ戻る */
function renameSidebarTab(tabId: TabId, name: string): void {
  sendMessage("renameTab", { tabId, name });
  imeEl.focus({ preventScroll: true });
}

/** サイドバーからのタイル名変更。空文字列を送るとbun側でデフォルトの連番ラベルへ戻る */
function renameSidebarTile(tileId: TileId, name: string): void {
  sendMessage("renameTile", { tileId, name });
  imeEl.focus({ preventScroll: true });
}

/** サイドバーからのワークスペース名変更。空文字列を送るとbun側でデフォルトの連番ラベルへ戻る */
function renameSidebarWorkspace(workspaceId: WorkspaceId, name: string): void {
  sendMessage("renameWorkspace", { workspaceId, name });
  imeEl.focus({ preventScroll: true });
}

function renderSidebarSwitcher(): void {
  sidebarSwitcherRoot.render(
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
 */
function setSidebarShowingCustom(showing: boolean): void {
  sidebarShowingCustom = showing;
  sidebarListEl.hidden = showing;
  sidebarCustomViewEl.classList.toggle("active", showing);
  customViewWebviewEl?.toggleHidden(!showing);
  renderSidebarSwitcher();
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
    // 生成時点から一度も0x0でOOPIFを同期させずに済み、toggleHiddenだけで正しく隠せる。
    // ただしtoggleHidden()はwebviewId確定後でないと送信先が無く無視されるため、
    // 初回のみdom-readyを待ってから呼ぶ
    const webviewEl = document.createElement("electrobun-webview") as WebviewTagElement;
    webviewEl.setAttribute("sandbox", "");
    webviewEl.src = customView.url;
    webviewEl.on("dom-ready", () => {
      webviewEl.toggleHidden(!sidebarShowingCustom);
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
  }
}

// ---- カーソル描画（タイルごと） ----
function updateCursorForTab(tabId: TabId, x: number, y: number, visible: boolean): void {
  const cursorEl = cursorElByTabId.get(tabId);
  if (!cursorEl) return;
  if (!visible) {
    cursorEl.style.display = "none";
    return;
  }
  cursorEl.style.display = "block";
  cursorEl.style.width = `${cellWidth}px`;
  cursorEl.style.height = `${cellHeight}px`;
  cursorEl.style.left = `${x * cellWidth}px`;
  cursorEl.style.top = `${y * cellHeight}px`;
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
}

/** ページ単位スクロール（Cmd+Up/Down等）の1ページ分の行数。表示中の行数をそのまま使う */
function visibleRows(tabId: TabId): number {
  const termEl = termElByTabId.get(tabId);
  if (!termEl) return 1;
  return Math.max(1, Math.floor(termEl.clientHeight / cellHeight));
}

// ---- マウスホイールでのスクロールバック閲覧 ----
// トラックパッドの細かいpxイベントを取りこぼさないよう、tabIdごとに端数を蓄積してから
// 1行に満たない分は次回に持ち越す
const wheelAccumPxByTabId = new Map<TabId, number>();

function handleWheelScroll(tabId: TabId, deltaPx: number): void {
  const accumulated = (wheelAccumPxByTabId.get(tabId) ?? 0) + deltaPx;
  const deltaLines = Math.trunc(accumulated / cellHeight);
  if (deltaLines === 0) {
    wheelAccumPxByTabId.set(tabId, accumulated);
    return;
  }
  wheelAccumPxByTabId.set(tabId, accumulated - deltaLines * cellHeight);
  sendMessage("scroll", { tabId, deltaLines });
}

tileTreeEl.addEventListener(
  "wheel",
  (e) => {
    const tileEl = (e.target as HTMLElement).closest<HTMLElement>(".tile");
    const tileId = tileEl?.dataset["tileId"];
    if (!tileId) return;
    const tabId = activeTabByTile.get(tileId);
    // ターミナルタブのみ対象（ブラウザタブはOOPIF自身のネイティブスクロールに任せる）
    if (!tabId || !termElByTabId.has(tabId)) return;
    e.preventDefault();
    // deltaMode: 0=pixel, 1=line, 2=page（DOM_DELTA_*）。line/pageは行高/表示行数で近似する
    const deltaPx =
      e.deltaMode === 1
        ? e.deltaY * cellHeight
        : e.deltaMode === 2
          ? e.deltaY * visibleRows(tabId) * cellHeight
          : e.deltaY;
    handleWheelScroll(tabId, deltaPx);
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
  // IME変換中のキーはcompositionイベント側で処理する（keyCode 229はWebKitのIME通知）
  if (e.isComposing || e.keyCode === 229) return;
  // ブラウザタブのURL入力欄編集中は、そのままネイティブのテキスト編集に任せる
  // （PTYへのバイト送信やタイル操作キーバインドに奪われないようにする）
  if (e.target instanceof HTMLInputElement) return;

  const tileCommand = resolveTileCommand(e, compiledKeybindings);
  if (tileCommand) {
    e.preventDefault();
    handleTileCommand(tileCommand);
    return;
  }

  if (!currentTabId) return;
  const bytes = keyToBytes(e);
  if (bytes !== null) {
    e.preventDefault();
    sendMessage("input", { tabId: currentTabId, data: bytes });
  }
});

function handleTileCommand(cmd: TileCommand): void {
  // サイドバー開閉はbun側の状態を必要としないため、フォーカス中タイル無しでも動作させる
  if (cmd.type === "toggleSidebar") {
    toggleSidebar();
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
    case "newTab":
      sendMessage("newTab", { tileId: focusedTileId });
      break;
    case "newBrowserTab":
      sendMessage("newBrowserTab", { tileId: focusedTileId });
      break;
    case "newCustomViewTab":
      sendMessage("newCustomViewTab", { tileId: focusedTileId });
      break;
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
    case "switchWorkspace": {
      if (!activeWorkspaceId || workspaceIds.length < 2) return;
      const index = workspaceIds.indexOf(activeWorkspaceId);
      const len = workspaceIds.length;
      const workspaceId = workspaceIds[(index + cmd.delta + len) % len];
      sendMessage("switchWorkspace", { workspaceId });
      break;
    }
    case "copySelection": {
      const text = window.getSelection()?.toString();
      if (text) sendMessage("copySelection", { text });
      break;
    }
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

imeEl.addEventListener("compositionstart", () => {
  composing = true;
  compositionEl.textContent = "";
  compositionEl.style.display = "block";
});

imeEl.addEventListener("compositionupdate", (e) => {
  compositionEl.textContent = e.data;
});

imeEl.addEventListener("compositionend", (e) => {
  composing = false;
  compositionEl.style.display = "none";
  compositionEl.textContent = "";
  imeEl.value = "";
  if (e.data && currentTabId) {
    sendMessage("input", { tabId: currentTabId, data: e.data });
  }
});

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
  if (text && currentTabId) sendMessage("paste", { tabId: currentTabId, data: text });
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

/** サイドバーのタブ行クリック。アクティブワークスペース内ならDOM即時反映、
 * 非アクティブワークスペースならDOMが存在しないためRPC送信のみで次のrenderを待つ */
function activateSidebarTab(workspaceId: WorkspaceId, tileId: TileId, tabId: TabId): void {
  if (workspaceId === activeWorkspaceId) {
    switchToTab(tileId, tabId);
  } else {
    sendMessage("switchWorkspace", { workspaceId });
    sendMessage("focusTile", { tileId });
    sendMessage("switchTab", { tileId, tabId });
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
imeEl.focus({ preventScroll: true });

// ---- 起動 ----
setupPalette();
applyAppearance(defaultAppearance);
applySidebarWidth(sidebarWidth);
attachSidebarDividerDrag();
applySidebarVisibility();
measureCell();
sendMessage("ready");
window.addEventListener("error", (e) => {
  sendMessage("log", { msg: `error: ${e.message}` });
});
