import Electrobun, { Electroview } from "electrobun/view";
import type { NiwaRPC } from "../bun/index";
import { keyToBytes } from "./key-to-bytes";
import { isWideChar } from "./wide-char";

const screenEl = document.getElementById("screen") as HTMLDivElement;
const termEl = document.getElementById("term") as HTMLDivElement;
const cursorEl = document.getElementById("cursor") as HTMLDivElement;
const measureEl = document.getElementById("measure") as HTMLSpanElement;
const imeEl = document.getElementById("ime-input") as HTMLTextAreaElement;
const compositionEl = document.getElementById("composition") as HTMLDivElement;

// ---- 256色パレットのCSS変数を定義する（formatter出力が var(--vt-palette-N) を参照する）----
function setupPalette() {
  const base16 = [
    "#45475a",
    "#f38ba8",
    "#a6e3a1",
    "#f9e2af",
    "#89b4fa",
    "#f5c2e7",
    "#94e2d5",
    "#bac2de",
    "#585b70",
    "#f38ba8",
    "#a6e3a1",
    "#f9e2af",
    "#89b4fa",
    "#f5c2e7",
    "#94e2d5",
    "#a6adc8",
  ];
  const root = document.documentElement.style;
  for (let i = 0; i < 16; i++) {
    root.setProperty(`--vt-palette-${i}`, base16[i] ?? "#ffffff");
  }
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

// ---- RPC ----
const rpc = Electroview.defineRPC<NiwaRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {},
    messages: {
      render: (p: { html: string; cursorX: number; cursorY: number; cursorVisible: boolean }) => {
        termEl.innerHTML = p.html;
        fixWideChars(termEl);
        updateCursor(p.cursorX, p.cursorY, p.cursorVisible);
      },
    },
  },
});

new Electrobun.Electroview({ rpc });

function sendMessage(name: string, payload?: unknown) {
  (rpc as any)?.send?.[name]?.(payload ?? {});
}

// ---- セル計測とリサイズ ----
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

function sendResize() {
  measureCell();
  const style = getComputedStyle(screenEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const cols = Math.max(2, Math.floor((screenEl.clientWidth - padX) / cellWidth));
  const rows = Math.max(2, Math.floor((screenEl.clientHeight - padY) / cellHeight));
  sendMessage("resize", { cols, rows, cellWidth, cellHeight });
}

new ResizeObserver(() => sendResize()).observe(screenEl);

// ---- カーソル描画 ----
let cursorPx = { left: 4, top: 4 };

function updateCursor(x: number, y: number, visible: boolean) {
  const termRect = termEl.getBoundingClientRect();
  cursorPx = {
    left: termRect.left + x * cellWidth,
    top: termRect.top + y * cellHeight,
  };
  // IME候補ウィンドウと未確定文字列をカーソルに追従させる
  imeEl.style.left = `${cursorPx.left}px`;
  imeEl.style.top = `${cursorPx.top}px`;
  compositionEl.style.left = `${cursorPx.left}px`;
  compositionEl.style.top = `${cursorPx.top}px`;
  if (!visible) {
    cursorEl.style.display = "none";
    return;
  }
  cursorEl.style.display = "block";
  cursorEl.style.width = `${cellWidth}px`;
  cursorEl.style.height = `${cellHeight}px`;
  cursorEl.style.left = `${cursorPx.left}px`;
  cursorEl.style.top = `${cursorPx.top}px`;
}

// ---- キー入力 → PTYバイト列 ----
document.addEventListener("keydown", (e) => {
  // IME変換中のキーはcompositionイベント側で処理する（keyCode 229はWebKitのIME通知）
  if (e.isComposing || e.keyCode === 229) return;
  const bytes = keyToBytes(e);
  if (bytes !== null) {
    e.preventDefault();
    sendMessage("input", { data: bytes });
  }
});

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
  if (e.data) {
    sendMessage("input", { data: e.data });
  }
});

// composition外でtextareaに入った入力の保険（dead key等）。二重送信はcomposingフラグで防ぐ
imeEl.addEventListener("input", (e) => {
  if (composing || (e as InputEvent).isComposing) return;
  if (imeEl.value) {
    sendMessage("input", { data: imeEl.value });
    imeEl.value = "";
  }
});

// ---- ペースト（Cmd+V）----
document.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = e.clipboardData?.getData("text/plain");
  if (text) sendMessage("paste", { data: text });
});

// キーボード・IME入力を受け取るためにtextareaへフォーカスを寄せる
screenEl.addEventListener("mousedown", (e) => {
  // テキスト選択（コピー用ドラッグ）を妨げないようフォーカスだけ移す
  if (e.target !== imeEl) {
    imeEl.focus({ preventScroll: true });
  }
});
window.addEventListener("focus", () => imeEl.focus({ preventScroll: true }));
imeEl.focus({ preventScroll: true });

// ---- 起動 ----
setupPalette();
measureCell();
sendResize();
sendMessage("ready");
window.addEventListener("error", (e) => {
  sendMessage("log", { msg: `error: ${e.message}` });
});
