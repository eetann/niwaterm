import Electrobun, { Electroview } from "electrobun/view";
import type { NiwaRPC } from "../bun/index";

const screenEl = document.getElementById("screen") as HTMLDivElement;
const termEl = document.getElementById("term") as HTMLDivElement;
const cursorEl = document.getElementById("cursor") as HTMLDivElement;
const measureEl = document.getElementById("measure") as HTMLSpanElement;

// ---- 256色パレットのCSS変数を定義する（formatter出力が var(--vt-palette-N) を参照する）----
function setupPalette() {
	const base16 = [
		"#45475a", "#f38ba8", "#a6e3a1", "#f9e2af",
		"#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
		"#585b70", "#f38ba8", "#a6e3a1", "#f9e2af",
		"#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8",
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
			render: (p: {
				html: string;
				cursorX: number;
				cursorY: number;
				cursorVisible: boolean;
			}) => {
				termEl.innerHTML = p.html;
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
}

function sendResize() {
	measureCell();
	const style = getComputedStyle(screenEl);
	const padX =
		parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
	const padY =
		parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
	const cols = Math.max(2, Math.floor((screenEl.clientWidth - padX) / cellWidth));
	const rows = Math.max(
		2,
		Math.floor((screenEl.clientHeight - padY) / cellHeight),
	);
	sendMessage("resize", { cols, rows, cellWidth, cellHeight });
}

new ResizeObserver(() => sendResize()).observe(screenEl);

// ---- カーソル描画 ----
function updateCursor(x: number, y: number, visible: boolean) {
	if (!visible) {
		cursorEl.style.display = "none";
		return;
	}
	const termRect = termEl.getBoundingClientRect();
	cursorEl.style.display = "block";
	cursorEl.style.width = `${cellWidth}px`;
	cursorEl.style.height = `${cellHeight}px`;
	cursorEl.style.left = `${termRect.left + x * cellWidth}px`;
	cursorEl.style.top = `${termRect.top + y * cellHeight}px`;
}

// ---- キー入力 → PTYバイト列 ----
function keyToBytes(e: KeyboardEvent): string | null {
	// cmd系はアプリ/OSのショートカットに譲る
	if (e.metaKey) return null;

	switch (e.key) {
		case "Enter":
			return "\r";
		case "Backspace":
			return "\x7f";
		case "Tab":
			return "\t";
		case "Escape":
			return "\x1b";
		case "ArrowUp":
			return "\x1b[A";
		case "ArrowDown":
			return "\x1b[B";
		case "ArrowRight":
			return "\x1b[C";
		case "ArrowLeft":
			return "\x1b[D";
		case "Home":
			return "\x1b[H";
		case "End":
			return "\x1b[F";
		case "Delete":
			return "\x1b[3~";
		case "PageUp":
			return "\x1b[5~";
		case "PageDown":
			return "\x1b[6~";
	}

	if (e.key.length === 1) {
		// Ctrl+英字 → 制御文字 (Ctrl+A = 0x01)
		if (e.ctrlKey) {
			const code = e.key.toUpperCase().charCodeAt(0);
			if (code >= 64 && code < 128) {
				return String.fromCharCode(code & 0x1f);
			}
			return null;
		}
		return e.key;
	}
	return null;
}

document.addEventListener("keydown", (e) => {
	// IME変換中は送らない（IME本対応は次セッション）
	if (e.isComposing) return;
	const bytes = keyToBytes(e);
	if (bytes !== null) {
		e.preventDefault();
		sendMessage("input", { data: bytes });
	}
});

// キーボードイベントを受け取るために#screenへフォーカスを寄せる
screenEl.tabIndex = -1;
screenEl.addEventListener("mousedown", () => screenEl.focus());
window.addEventListener("focus", () => screenEl.focus());
screenEl.focus();

// ---- 起動 ----
setupPalette();
measureCell();
sendResize();
sendMessage("ready");
window.addEventListener("error", (e) => {
	sendMessage("log", { msg: `error: ${e.message}` });
});
