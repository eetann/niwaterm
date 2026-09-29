// ウィンドウ下端のステータスバー（設定のstatusBar）の表示。
// 部品の並びと押せるかどうかはconfigで、部品の値はstatusBarValuesでbun側から届く。
// builtin:modeだけはprefix待ち・コピーモードの状態をこちらが持っているため、ここで描く。
//
// バーはターミナルに重ねず、高さぶんをレイアウトから差し引く（--status-bar-height）。
// ブラウザタブのネイティブwebviewはHTMLより手前に描かれるため、重ねるとバーが隠れる。

import type { ResolvedStatusBarConfig, StatusBarSection, StatusBarValue } from "@niwaterm/config";
import { DOM_TOOLTIP_ATTR } from "./dom-tooltip";

/** builtin:modeで出すキー入力のモード */
export type StatusBarMode = "normal" | "prefix" | "copy";

const MODE_LABELS: Record<StatusBarMode, string> = {
  normal: "NORMAL",
  prefix: "PREFIX",
  copy: "COPY",
};

export interface StatusBarOptions {
  container: HTMLElement;
  /** 今のモード。refreshModeのたびに問い合わせる */
  getMode(): StatusBarMode;
  /** 押された部品をbunへ伝える */
  runItem(id: string): void;
  /** 押した後にキーボードフォーカスをターミナルへ戻す */
  refocusTerminal(): void;
}

export interface StatusBarView {
  setConfig(config: ResolvedStatusBarConfig): void;
  setValues(values: Record<string, StatusBarValue>): void;
  /** ユーザーがバーを隠したか（toggle-status-bar）。設定のvisibleと両方が出す指定の時だけ出す */
  setHidden(hidden: boolean): void;
  /** モードが変わりうる操作（キー入力・描画・フォーカス喪失）の後に呼ぶ。変化が無ければDOMに触らない */
  refreshMode(): void;
}

const SECTIONS: readonly StatusBarSection[] = ["left", "center", "right"];

export function createStatusBar(opts: StatusBarOptions): StatusBarView {
  const { container } = opts;
  const styleEl = document.createElement("style");
  document.head.appendChild(styleEl);
  const sectionEls = new Map<StatusBarSection, HTMLElement>();
  for (const section of SECTIONS) {
    const el = document.createElement("div");
    el.className = "status-section";
    el.dataset["section"] = section;
    container.appendChild(el);
    sectionEls.set(section, el);
  }
  const itemEls = new Map<string, HTMLElement>();
  const modeEls: HTMLElement[] = [];
  let values: Record<string, StatusBarValue> = {};
  let currentMode: StatusBarMode | null = null;
  /** 設定し直した時の比較用。同じ並びならDOMを作り直さない（値の表示を消さない） */
  let lastConfigKey = "";
  let configVisible = false;
  let hidden = false;

  function applyValue(el: HTMLElement, value: StatusBarValue | undefined): void {
    const empty = value === undefined || (value.text === "" && value.html === "");
    el.hidden = empty;
    if (empty) return;
    if (value.html !== "") el.innerHTML = value.html;
    else el.textContent = value.text;
    if (value.tooltip === "") el.removeAttribute(DOM_TOOLTIP_ATTR);
    else el.setAttribute(DOM_TOOLTIP_ATTR, value.tooltip);
    if (value.color === "") el.style.removeProperty("color");
    else el.style.color = value.color;
  }

  function applyMode(el: HTMLElement, mode: StatusBarMode): void {
    el.dataset["mode"] = mode;
    el.textContent = MODE_LABELS[mode];
  }

  function applyVisibility(): void {
    const visible = configVisible && !hidden;
    container.hidden = !visible;
    document.documentElement.classList.toggle("has-status-bar", visible);
  }

  container.addEventListener("click", (e) => {
    const target = (e.target as Element | null)?.closest<HTMLElement>(".status-item.clickable");
    const id = target?.dataset["id"];
    if (id === undefined) return;
    opts.runItem(id);
    opts.refocusTerminal();
  });
  // 押した瞬間にターミナルのフォーカスが外れると、その間のキー入力を取りこぼす
  container.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  return {
    setConfig(config) {
      styleEl.textContent = config.css;
      const key = JSON.stringify(config);
      if (key === lastConfigKey) return;
      lastConfigKey = key;
      itemEls.clear();
      modeEls.length = 0;
      currentMode = null;
      for (const section of SECTIONS) {
        const sectionEl = sectionEls.get(section);
        if (!sectionEl) continue;
        sectionEl.replaceChildren(
          ...config.sections[section].map((item) => {
            const el = document.createElement("span");
            el.className = item.kind === "mode" ? "status-item status-mode" : "status-item";
            if (item.clickable) el.classList.add("clickable");
            el.dataset["id"] = item.id;
            if (item.kind === "mode") modeEls.push(el);
            else {
              itemEls.set(item.id, el);
              applyValue(el, values[item.id]);
            }
            return el;
          }),
        );
      }
      configVisible = config.visible;
      applyVisibility();
      this.refreshMode();
    },
    setHidden(next) {
      hidden = next;
      applyVisibility();
    },
    setValues(next) {
      values = next;
      for (const [id, el] of itemEls) applyValue(el, values[id]);
    },
    refreshMode() {
      if (modeEls.length === 0) return;
      const mode = opts.getMode();
      if (mode === currentMode) return;
      currentMode = mode;
      for (const el of modeEls) applyMode(el, mode);
    },
  };
}
