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
import type { NiwaRPC } from "../bun/index";
import type { TabRenderState } from "../bun/workspace";
import {
  findNode,
  listLeaves,
  nextTabId,
  type TabId,
  type TileId,
  type TileNode,
} from "../bun/tile-layout";
import type { AppRenderState, WorkspaceId, WorkspaceListEntry } from "../bun/workspace-manager";
import { buildExecBrowserJsScript } from "./browser-js-bridge";
import { keyToBytes } from "./key-to-bytes";
import { normalizeUrl } from "./normalize-url";
import { resolveTileCommand, type TileCommand } from "./tile-keybindings";
import { isWideChar } from "./wide-char";

const screenEl = document.getElementById("screen") as HTMLDivElement;
const tileTreeEl = document.getElementById("tile-tree") as HTMLDivElement;
const measureEl = document.getElementById("measure") as HTMLSpanElement;
const imeEl = document.getElementById("ime-input") as HTMLTextAreaElement;
const compositionEl = document.getElementById("composition") as HTMLDivElement;
const tileTemplate = document.getElementById("tile-template") as HTMLTemplateElement;
const tabButtonTemplate = document.getElementById("tab-button-template") as HTMLTemplateElement;
const tabContentTemplate = document.getElementById("tab-content-template") as HTMLTemplateElement;
const shellProfileMenuTemplate = document.getElementById(
  "shell-profile-menu-template",
) as HTMLTemplateElement;
const shellProfileMenuItemTemplate = document.getElementById(
  "shell-profile-menu-item-template",
) as HTMLTemplateElement;
const sidebarEl = document.getElementById("sidebar") as HTMLElement;
const sidebarListEl = document.getElementById("sidebar-list") as HTMLDivElement;
const sidebarSwitcherEl = document.getElementById("sidebar-switcher") as HTMLDivElement;
const sidebarSwitchListBtn = document.getElementById("sidebar-switch-list") as HTMLButtonElement;
const sidebarSwitchCustomBtn = document.getElementById(
  "sidebar-switch-custom",
) as HTMLButtonElement;
const sidebarCustomViewEl = document.getElementById("sidebar-custom-view") as HTMLDivElement;
const sidebarWorkspaceTemplate = document.getElementById(
  "sidebar-workspace-template",
) as HTMLTemplateElement;
const sidebarTabTemplate = document.getElementById("sidebar-tab-template") as HTMLTemplateElement;
const browserToolbarTemplate = document.getElementById(
  "browser-toolbar-template",
) as HTMLTemplateElement;

// ---- タイル/タブごとのDOM要素・状態管理 ----
const tileElByTileId = new Map<TileId, HTMLElement>();
const tabBarElByTileId = new Map<TileId, HTMLDivElement>();
const tabContentElByTabId = new Map<TabId, HTMLDivElement>();
const tabButtonElByTabId = new Map<TabId, HTMLButtonElement>();
const termElByTabId = new Map<TabId, HTMLDivElement>();
const cursorElByTabId = new Map<TabId, HTMLDivElement>();
const browserElByTabId = new Map<TabId, WebviewTagElement>();
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

// ---- サイドバーごとのDOM要素・状態管理（タイル木のMapとは独立させる。
// サイドバーは全ワークスペースを表示するため、タイル木側のgcStale基準
// 「アクティブワークスペースに登場しないID＝stale」を共有すると誤って消えてしまう）----
const sidebarWorkspaceElByWorkspaceId = new Map<WorkspaceId, HTMLDivElement>();
const sidebarHeaderElByWorkspaceId = new Map<WorkspaceId, HTMLButtonElement>();
const sidebarTabListElByWorkspaceId = new Map<WorkspaceId, HTMLDivElement>();
const sidebarTabRowElByTabId = new Map<TabId, HTMLButtonElement>();

// ---- サイドバーのユーザー定義HTML UI（customView）----
let customViewWebviewEl: WebviewTagElement | null = null;
let customViewUrl: string | null = null;
let sidebarShowingCustom = false;

let focusedTileId: TileId | null = null;
// フォーカス中タイルのactiveTabId（キー入力・ペーストの送信先）
let currentTabId: TabId | null = null;
// 直近のrender()で受け取ったlayout。cycleTab等、キー操作時にDOM待ちせず参照するために保持する
let lastLayout: TileNode | null = null;
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
// 開いているシェルプロファイルメニュー。外側クリック等で閉じるため対象tileIdと要素を保持する
let openShellProfileMenu: { tileId: TileId; menuEl: HTMLDivElement } | null = null;

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
          termEl.innerHTML = stripFormatterLeadingBlankLine(renderState.html);
          fixWideChars(termEl);
          updateCursorForTab(
            tabId,
            renderState.cursorX,
            renderState.cursorY,
            renderState.cursorVisible,
          );
          if (tabId === currentTabId) {
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

// libghostty-vtのHTMLフォーマッタは、アクティブエリアが一度でも実際にスクロールすると
// 出力の先頭に余分な空行(\n)を1つ付け足す（<pre>タグの「先頭改行1つを無視する」挙動を
// 前提にしているとみられる）。.termは<pre>ではなくwhite-space:pre指定の<div>なので
// その先頭改行がそのまま空行として描画され、cursorY基準のカーソル位置と1行分ズレる。
function stripFormatterLeadingBlankLine(html: string): string {
  return html.replace(/^(<div[^>]*>)\n/, "$1");
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
    } else {
      tabBarEl = tabBarElByTileId.get(node.id) as HTMLDivElement;
      tileContentEl = tileEl.querySelector(".tile-content") as HTMLDivElement;
    }
    tileEl.dataset["tileId"] = node.id;
    const addBtn = tabBarEl.querySelector(".tab-add-btn") as HTMLButtonElement;

    node.tabIds.forEach((tabId, index) => {
      seenTabIds.add(tabId);
      const renderState = tabs[tabId];
      if (renderState) ensureTabContent(tabId, tileContentEl, renderState);
      ensureTabButton(tabId, tabBarEl, addBtn);
      const isActive = tabId === node.activeTabId;
      setTabVisible(tabId, isActive);
      const tabButtonEl = tabButtonElByTabId.get(tabId);
      tabButtonEl?.classList.toggle("active", isActive);
      const labelEl = tabButtonEl?.querySelector(".tab-label");
      if (labelEl) labelEl.textContent = String(index + 1);
    });

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

/** tabId用の.tab-contentを種別に応じて必要なら生成する。既存の場合は何もしない（種別は初回のrenderで固定） */
function ensureTabContent(
  tabId: TabId,
  tileContentEl: HTMLDivElement,
  renderState: TabRenderState,
): void {
  if (tabContentElByTabId.has(tabId)) return;
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
    if (draggingSplitId || pendingSplitRatio) return;
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

  const toolbarFrag = browserToolbarTemplate.content.cloneNode(true) as DocumentFragment;
  const toolbarEl = toolbarFrag.querySelector(".browser-toolbar") as HTMLDivElement;
  const backBtn = toolbarEl.querySelector(".browser-back") as HTMLButtonElement;
  const forwardBtn = toolbarEl.querySelector(".browser-forward") as HTMLButtonElement;
  const reloadBtn = toolbarEl.querySelector(".browser-reload") as HTMLButtonElement;
  const urlInput = toolbarEl.querySelector(".browser-url-input") as HTMLInputElement;
  urlInput.value = url;
  backBtn.disabled = true;
  forwardBtn.disabled = true;

  const webviewEl = document.createElement("electrobun-webview") as WebviewTagElement;
  webviewEl.setAttribute("sandbox", "");
  webviewEl.src = url;

  // Escで編集を取り消す際に戻す先。did-navigateのたびに最新のURLへ更新する
  let lastKnownUrl = url;

  const updateNavButtons = () => {
    void webviewEl.canGoBack().then((canGoBack) => {
      backBtn.disabled = !canGoBack;
    });
    void webviewEl.canGoForward().then((canGoForward) => {
      forwardBtn.disabled = !canGoForward;
    });
  };

  backBtn.addEventListener("click", () => webviewEl.goBack());
  forwardBtn.addEventListener("click", () => webviewEl.goForward());
  reloadBtn.addEventListener("click", () => webviewEl.reload());

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      webviewEl.loadURL(normalizeUrl(urlInput.value));
      imeEl.focus({ preventScroll: true });
    } else if (e.key === "Escape") {
      urlInput.value = lastKnownUrl;
      imeEl.focus({ preventScroll: true });
    }
  });

  webviewEl.on("did-navigate", (e) => {
    const newUrl = String((e as CustomEvent).detail ?? "");
    if (newUrl) {
      lastKnownUrl = newUrl;
      if (document.activeElement !== urlInput) urlInput.value = newUrl;
    }
    updateNavButtons();
  });

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
  // ""に戻すことでCSS側のdisplay指定（ターミナルはblock、ブラウザは.browserのflex）に委ねる
  if (tabContentEl) tabContentEl.style.display = visible ? "" : "none";
  browserElByTabId.get(tabId)?.toggleHidden(!visible);
}

/** tabId用のタブボタンを必要なら生成し、+ボタンの直前に挿入する（tabIds配列の順序を保つ） */
function ensureTabButton(tabId: TabId, tabBarEl: HTMLDivElement, addBtn: HTMLButtonElement): void {
  if (tabButtonElByTabId.has(tabId)) return;
  const frag = tabButtonTemplate.content.cloneNode(true) as DocumentFragment;
  const btnEl = frag.querySelector(".tab-button") as HTMLButtonElement;
  btnEl.dataset["tabId"] = tabId;
  tabButtonElByTabId.set(tabId, btnEl);
  tabBarEl.insertBefore(btnEl, addBtn);
}

/** クリック/キー操作でのタブ切替をローカルへ即時反映する（次のrenderを待たず入力送信先を切り替えるため） */
function setActiveTabLocally(tileId: TileId, tabId: TabId): void {
  const previousActive = activeTabByTile.get(tileId);
  if (previousActive === tabId) return;
  activeTabByTile.set(tileId, tabId);
  if (previousActive) {
    setTabVisible(previousActive, false);
    tabButtonElByTabId.get(previousActive)?.classList.remove("active");
  }
  setTabVisible(tabId, true);
  tabButtonElByTabId.get(tabId)?.classList.add("active");
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
    tabButtonElByTabId.get(tabId)?.remove();
    tabButtonElByTabId.delete(tabId);
    termElByTabId.delete(tabId);
    cursorElByTabId.delete(tabId);
    browserElByTabId.delete(tabId);
    browserDomReadyByTabId.delete(tabId);
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
    tileEl.remove();
    tileElByTileId.delete(tileId);
    tabBarElByTileId.delete(tileId);
    if (openShellProfileMenu?.tileId === tileId) closeShellProfileMenu();
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
  const seenWorkspaceIds = new Set<WorkspaceId>();
  const seenTabIds = new Set<TabId>();

  workspaces.forEach((entry, workspaceIndex) => {
    seenWorkspaceIds.add(entry.workspaceId);
    const { workspaceEl, headerEl, tabListEl } = ensureSidebarWorkspace(entry.workspaceId);
    if (workspaceEl.parentElement !== sidebarListEl) {
      sidebarListEl.appendChild(workspaceEl);
    }
    headerEl.textContent = `Workspace ${workspaceIndex + 1}`;
    headerEl.dataset["workspaceId"] = entry.workspaceId;
    headerEl.classList.toggle("active", entry.workspaceId === currentActiveWorkspaceId);

    for (const [tileIndex, leaf] of listLeaves(entry.layout).entries()) {
      // タイル変数はタイル単位（同一タイル内の複数タブで共有）。
      // シェル統合スクリプトが`branch`変数へgitブランチ名を書く運用を想定した表示
      const branch = entry.tileVars[leaf.id]?.["branch"];
      leaf.tabIds.forEach((tabId, tabIndex) => {
        seenTabIds.add(tabId);
        const rowEl = ensureSidebarTabRow(tabId, tabListEl);
        const label = `Tile ${tileIndex + 1} / Tab ${tabIndex + 1}`;
        rowEl.textContent = branch ? `${label} · ${branch}` : label;
        rowEl.dataset["workspaceId"] = entry.workspaceId;
        rowEl.dataset["tileId"] = leaf.id;
        rowEl.dataset["tabId"] = tabId;
        rowEl.classList.toggle(
          "active",
          entry.workspaceId === currentActiveWorkspaceId && tabId === leaf.activeTabId,
        );
      });
    }
  });

  gcSidebarStale(seenWorkspaceIds, seenTabIds);
}

function ensureSidebarWorkspace(workspaceId: WorkspaceId): {
  workspaceEl: HTMLDivElement;
  headerEl: HTMLButtonElement;
  tabListEl: HTMLDivElement;
} {
  let workspaceEl = sidebarWorkspaceElByWorkspaceId.get(workspaceId);
  if (!workspaceEl) {
    const frag = sidebarWorkspaceTemplate.content.cloneNode(true) as DocumentFragment;
    workspaceEl = frag.querySelector(".sidebar-workspace") as HTMLDivElement;
    sidebarWorkspaceElByWorkspaceId.set(workspaceId, workspaceEl);
    sidebarHeaderElByWorkspaceId.set(
      workspaceId,
      workspaceEl.querySelector(".sidebar-workspace-header") as HTMLButtonElement,
    );
    sidebarTabListElByWorkspaceId.set(
      workspaceId,
      workspaceEl.querySelector(".sidebar-tab-list") as HTMLDivElement,
    );
  }
  return {
    workspaceEl,
    headerEl: sidebarHeaderElByWorkspaceId.get(workspaceId) as HTMLButtonElement,
    tabListEl: sidebarTabListElByWorkspaceId.get(workspaceId) as HTMLDivElement,
  };
}

function ensureSidebarTabRow(tabId: TabId, tabListEl: HTMLDivElement): HTMLButtonElement {
  let rowEl = sidebarTabRowElByTabId.get(tabId);
  if (!rowEl) {
    const frag = sidebarTabTemplate.content.cloneNode(true) as DocumentFragment;
    rowEl = frag.querySelector(".sidebar-tab") as HTMLButtonElement;
    sidebarTabRowElByTabId.set(tabId, rowEl);
  }
  if (rowEl.parentElement !== tabListEl) {
    tabListEl.appendChild(rowEl);
  }
  return rowEl;
}

/** 前回登場したが今回登場しなかったworkspace/tabの後始末 */
function gcSidebarStale(seenWorkspaceIds: Set<WorkspaceId>, seenTabIds: Set<TabId>): void {
  for (const tabId of sidebarTabRowElByTabId.keys()) {
    if (seenTabIds.has(tabId)) continue;
    sidebarTabRowElByTabId.get(tabId)?.remove();
    sidebarTabRowElByTabId.delete(tabId);
  }
  for (const [workspaceId, workspaceEl] of sidebarWorkspaceElByWorkspaceId) {
    if (seenWorkspaceIds.has(workspaceId)) continue;
    workspaceEl.remove();
    sidebarWorkspaceElByWorkspaceId.delete(workspaceId);
    sidebarHeaderElByWorkspaceId.delete(workspaceId);
    sidebarTabListElByWorkspaceId.delete(workspaceId);
  }
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
  sidebarSwitchListBtn.classList.toggle("active", !showing);
  sidebarSwitchCustomBtn.classList.toggle("active", showing);
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
  sidebarSwitchCustomBtn.textContent = customView.name;

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

sidebarSwitchListBtn.addEventListener("click", () => setSidebarShowingCustom(false));
sidebarSwitchCustomBtn.addEventListener("click", () => setSidebarShowingCustom(true));

function applySidebarVisibility(): void {
  sidebarEl.style.display = sidebarOpen ? "" : "none";
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

function closeShellProfileMenu(): void {
  if (!openShellProfileMenu) return;
  openShellProfileMenu.menuEl.remove();
  openShellProfileMenu = null;
}

/**
 * +ボタン横の「⌄」ドロップダウンをクリックした際、シェルプロファイル一覧のポップアップメニューを
 * anchorElの直下に表示する。「デフォルト」項目（shellProfileId省略でnewTabを送る）を先頭に持つ
 */
function openShellProfileMenuFor(tileId: TileId, anchorEl: HTMLElement): void {
  closeShellProfileMenu();
  const menuFrag = shellProfileMenuTemplate.content.cloneNode(true) as DocumentFragment;
  const menuEl = menuFrag.querySelector(".shell-profile-menu") as HTMLDivElement;

  function addItem(label: string, shellProfileId: string | undefined): void {
    const itemFrag = shellProfileMenuItemTemplate.content.cloneNode(true) as DocumentFragment;
    const itemEl = itemFrag.querySelector(".shell-profile-menu-item") as HTMLButtonElement;
    itemEl.textContent = label;
    if (shellProfileId !== undefined) itemEl.dataset["shellProfileId"] = shellProfileId;
    menuEl.appendChild(itemEl);
  }

  addItem("デフォルト", undefined);
  for (const profile of shellProfiles) {
    addItem(profile.name, profile.id);
  }

  menuEl.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    const itemEl = (e.target as HTMLElement).closest<HTMLElement>(".shell-profile-menu-item");
    if (!itemEl) return;
    const shellProfileId = itemEl.dataset["shellProfileId"];
    focusTileLocally(tileId);
    sendMessage("newTab", shellProfileId ? { tileId, shellProfileId } : { tileId });
    closeShellProfileMenu();
    imeEl.focus({ preventScroll: true });
  });

  document.body.appendChild(menuEl);
  const rect = anchorEl.getBoundingClientRect();
  menuEl.style.left = `${rect.left}px`;
  menuEl.style.top = `${rect.bottom + 2}px`;

  openShellProfileMenu = { tileId, menuEl };
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

sidebarListEl.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  const tabRowEl = target.closest<HTMLElement>(".sidebar-tab");
  if (tabRowEl) {
    const workspaceId = tabRowEl.dataset["workspaceId"];
    const tileId = tabRowEl.dataset["tileId"];
    const tabId = tabRowEl.dataset["tabId"];
    if (workspaceId && tileId && tabId) activateSidebarTab(workspaceId, tileId, tabId);
    return;
  }
  const headerEl = target.closest<HTMLElement>(".sidebar-workspace-header");
  const workspaceId = headerEl?.dataset["workspaceId"];
  if (workspaceId && workspaceId !== activeWorkspaceId) {
    sendMessage("switchWorkspace", { workspaceId });
    imeEl.focus({ preventScroll: true });
  }
});

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

  const closeBtn = target.closest<HTMLElement>(".tab-close-btn");
  const tabButtonEl = target.closest<HTMLElement>(".tab-button");
  const tabId = tabButtonEl?.dataset["tabId"];

  if (closeBtn && tabId) {
    sendMessage("closeTab", { tileId, tabId });
    imeEl.focus({ preventScroll: true });
    return;
  }
  if (tabButtonEl && tabId) {
    switchToTab(tileId, tabId);
    imeEl.focus({ preventScroll: true });
    return;
  }
  if (target.closest<HTMLElement>(".tab-add-btn")) {
    focusTileLocally(tileId);
    sendMessage("newTab", { tileId });
    imeEl.focus({ preventScroll: true });
    return;
  }
  const dropdownBtn = target.closest<HTMLElement>(".tab-add-dropdown-btn");
  if (dropdownBtn) {
    focusTileLocally(tileId);
    if (openShellProfileMenu?.tileId === tileId) {
      closeShellProfileMenu();
    } else {
      openShellProfileMenuFor(tileId, dropdownBtn);
    }
    return;
  }

  focusTileLocally(tileId);
  // テキスト選択（コピー用ドラッグ）を妨げないようフォーカスだけ移す
  imeEl.focus({ preventScroll: true });
});
// シェルプロファイルメニュー外（ドロップダウンボタン自体を除く）をクリックしたら閉じる。
// メニュー・ドロップダウンボタン自身のmousedownはtileTreeEl側で先に処理されバブリングしてくるため、
// ここでは「それ以外」を判定するだけでよい
window.addEventListener("mousedown", (e) => {
  if (!openShellProfileMenu) return;
  const target = e.target as HTMLElement;
  if (target.closest(".shell-profile-menu") || target.closest(".tab-add-dropdown-btn")) return;
  closeShellProfileMenu();
});
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
applySidebarVisibility();
measureCell();
sendMessage("ready");
window.addEventListener("error", (e) => {
  sendMessage("log", { msg: `error: ${e.message}` });
});
