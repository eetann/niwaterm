import Electrobun, { Electroview } from "electrobun/view";
import {
  compileKeybindings,
  defaultAppearance,
  defaultKeybindings,
  type KeybindingsConfig,
  type ResolvedAppearanceConfig,
} from "@niwaterm/config";
import type { NiwaRPC } from "../bun/index";
import { findNode, nextTabId, type TabId, type TileId, type TileNode } from "../bun/tile-layout";
import type { AppRenderState, WorkspaceId } from "../bun/workspace-manager";
import { keyToBytes } from "./key-to-bytes";
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

// ---- タイル/タブごとのDOM要素・状態管理 ----
const tileElByTileId = new Map<TileId, HTMLElement>();
const tabBarElByTileId = new Map<TileId, HTMLDivElement>();
const tabContentElByTabId = new Map<TabId, HTMLDivElement>();
const tabButtonElByTabId = new Map<TabId, HTMLButtonElement>();
const termElByTabId = new Map<TabId, HTMLDivElement>();
const cursorElByTabId = new Map<TabId, HTMLDivElement>();
const resizeObserverByTabId = new Map<TabId, ResizeObserver>();
const activeTabByTile = new Map<TileId, TabId>();
const splitElBySplitId = new Map<TileId, HTMLDivElement>();
const dividerElBySplitId = new Map<TileId, HTMLDivElement>();

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
// bun側からのkeybindingsメッセージ到達前はデフォルトキーバインドにフォールバックする
let compiledKeybindings = compileKeybindings(defaultKeybindings);

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
    requests: {},
    messages: {
      render: (p: AppRenderState) => {
        activeWorkspaceId = p.activeWorkspaceId;
        workspaceIds = p.workspaceIds;
        lastLayout = p.workspace.layout;
        renderLayout(p.workspace.layout);
        focusedTileId = p.workspace.focusedTileId;
        currentTabId = (focusedTileId && activeTabByTile.get(focusedTileId)) ?? null;
        updateFocusHighlight();
        for (const tabId of Object.keys(p.workspace.tabs)) {
          const renderState = p.workspace.tabs[tabId];
          const termEl = termElByTabId.get(tabId);
          if (!termEl || !renderState) continue;
          termEl.innerHTML = renderState.html;
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
      }: {
        keybindings: KeybindingsConfig;
        appearance: ResolvedAppearanceConfig;
      }) => {
        compiledKeybindings = compileKeybindings(keybindings);
        applyAppearance(appearance);
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
function renderLayout(layout: TileNode): void {
  const seenTabIds = new Set<TabId>();
  const seenSplitIds = new Set<TileId>();
  const seenTileIds = new Set<TileId>();
  const rootEl = reconcile(layout, seenTabIds, seenSplitIds, seenTileIds);
  if (rootEl.parentElement !== tileTreeEl) {
    tileTreeEl.appendChild(rootEl);
  }
  gcStale(seenTabIds, seenSplitIds, seenTileIds);
}

function reconcile(
  node: TileNode,
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
      ensureTabContent(tabId, tileContentEl);
      ensureTabButton(tabId, tabBarEl, addBtn);
      const isActive = tabId === node.activeTabId;
      const tabContentEl = tabContentElByTabId.get(tabId);
      if (tabContentEl) tabContentEl.style.display = isActive ? "block" : "none";
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

  const firstEl = reconcile(node.first, seenTabIds, seenSplitIds, seenTileIds);
  const dividerEl = getOrCreateDivider(node.id);
  const secondEl = reconcile(node.second, seenTabIds, seenSplitIds, seenTileIds);

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

/** tabId用の.term/.cursorペア（.tab-content）を必要なら生成し、ResizeObserverを設置する */
function ensureTabContent(tabId: TabId, tileContentEl: HTMLDivElement): void {
  if (termElByTabId.has(tabId)) return;
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
    const prevContent = tabContentElByTabId.get(previousActive);
    if (prevContent) prevContent.style.display = "none";
    tabButtonElByTabId.get(previousActive)?.classList.remove("active");
  }
  const nextContent = tabContentElByTabId.get(tabId);
  if (nextContent) nextContent.style.display = "block";
  tabButtonElByTabId.get(tabId)?.classList.add("active");
}

/** 前回登場したが今回登場しなかったtab/split/tileの後始末（DOM除去・ResizeObserver停止） */
function gcStale(
  seenTabIds: Set<TabId>,
  seenSplitIds: Set<TileId>,
  seenTileIds: Set<TileId>,
): void {
  // 個別に閉じられたタブ（タイル自体は生存）の後始末。.tab-content単位で除去し、
  // 同じタイルに残る他のタブには影響しない
  for (const tabId of termElByTabId.keys()) {
    if (seenTabIds.has(tabId)) continue;
    resizeObserverByTabId.get(tabId)?.disconnect();
    resizeObserverByTabId.delete(tabId);
    tabContentElByTabId.get(tabId)?.remove();
    tabContentElByTabId.delete(tabId);
    tabButtonElByTabId.get(tabId)?.remove();
    tabButtonElByTabId.delete(tabId);
    termElByTabId.delete(tabId);
    cursorElByTabId.delete(tabId);
  }
  // タイルごと閉じられた場合の後始末（配下のタブは上のループで既に個別除去済み）
  for (const [tileId, tileEl] of tileElByTileId) {
    if (seenTileIds.has(tileId)) continue;
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

tileTreeEl.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  const tileEl = target.closest<HTMLElement>(".tile");
  const tileId = tileEl?.dataset["tileId"];
  if (!tileId) return;

  const closeBtn = target.closest<HTMLElement>(".tab-close-btn");
  const tabButtonEl = target.closest<HTMLElement>(".tab-button");
  const tabId = tabButtonEl?.dataset["tabId"];

  if (closeBtn && tabId) {
    sendMessage("closeTab", { tileId, tabId });
    imeEl.focus({ preventScroll: true });
    return;
  }
  if (tabButtonEl && tabId) {
    setActiveTabLocally(tileId, tabId);
    focusTileLocally(tileId);
    currentTabId = tabId;
    sendMessage("switchTab", { tileId, tabId });
    imeEl.focus({ preventScroll: true });
    return;
  }
  if (target.closest<HTMLElement>(".tab-add-btn")) {
    focusTileLocally(tileId);
    sendMessage("newTab", { tileId });
    imeEl.focus({ preventScroll: true });
    return;
  }

  focusTileLocally(tileId);
  // テキスト選択（コピー用ドラッグ）を妨げないようフォーカスだけ移す
  imeEl.focus({ preventScroll: true });
});
window.addEventListener("focus", () => imeEl.focus({ preventScroll: true }));
imeEl.focus({ preventScroll: true });

// ---- 起動 ----
setupPalette();
applyAppearance(defaultAppearance);
measureCell();
sendMessage("ready");
window.addEventListener("error", (e) => {
  sendMessage("log", { msg: `error: ${e.message}` });
});
