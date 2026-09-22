// vimiumのfヒント相当のジャンプモード。ジャンプ先へラベルを重ねて表示し、打鍵で1つへ絞り込む。
// 「どれをジャンプ先にするか」「押されたら何をするか」は呼び出し側（index.ts）が組み立てて
// HintTargetとして渡す。このモジュールはラベルの配置・絞り込み・後片付けだけを担う。

import { assignHintLabels, matchHintInput } from "./hint-labels";

export interface HintTarget {
  /** ラベルの位置決めに使う要素。ジャンプ自体はjumpへ委ねるのでクリックはしない */
  el: HTMLElement;
  /** ラベルを要素の中央へ置くか。falseなら左上の角。タイルのように面で示す対象だけtrueにする */
  center: boolean;
  jump: () => void;
}

/** keydownイベントから使うプロパティだけを受け取る（tile-keybindingsのKeyboardEventLikeと同じ方針） */
export type HintKeyboardEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">;

export interface HintMode {
  isActive(): boolean;
  /** ラベルを出してヒントモードへ入る。表示できる対象が1つも無ければ入らずfalseを返す */
  enter(targets: HintTarget[]): boolean;
  exit(): void;
  /** ヒントモード中のkeydownを処理したならtrue（呼び出し側はpreventDefaultして打ち切る） */
  handleKeydown(e: HintKeyboardEvent): boolean;
}

/** 修飾キー単体のkeydown。押しただけでヒントモードを抜けてしまわないよう読み飛ばす */
const MODIFIER_KEY_NAMES = new Set(["Shift", "Control", "Alt", "Meta"]);

/** ラベルを要素の角へ置くときの内側へのめり込み量(px)。枠線と重ねて対象との対応を分かりやすくする */
const CORNER_INSET_PX = 2;

/** 要素がビューポート内に面を持つか。サイドバーのスクロールで流れ出た行もここで落ちる */
function isOnScreen(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return (
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight
  );
}

export function createHintMode(layerEl: HTMLElement): HintMode {
  // ラベル文字列→ジャンプ先と、そのラベルを描いている要素。活性時のみ中身が入る
  const entries = new Map<string, { target: HintTarget; labelEl: HTMLElement }>();
  let typed = "";

  /** 打鍵済みの文字を薄く、残りを濃く描く。既に外れたラベルは隠す */
  function paint(): void {
    for (const [label, { labelEl }] of entries) {
      if (!label.startsWith(typed)) {
        labelEl.hidden = true;
        continue;
      }
      labelEl.hidden = false;
      labelEl.textContent = "";
      if (typed.length > 0) {
        const typedEl = document.createElement("span");
        typedEl.className = "typed";
        typedEl.textContent = typed;
        labelEl.append(typedEl);
      }
      labelEl.append(label.slice(typed.length));
    }
  }

  function exit(): void {
    entries.clear();
    typed = "";
    layerEl.replaceChildren();
    layerEl.hidden = true;
  }

  function enter(targets: HintTarget[]): boolean {
    exit();
    const visible = targets.filter((target) => isOnScreen(target.el));
    const labels = assignHintLabels(visible.length);
    if (labels.length === 0) return false;
    for (const [index, target] of visible.entries()) {
      const label = labels[index] as string;
      const rect = target.el.getBoundingClientRect();
      const labelEl = document.createElement("span");
      labelEl.className = "hint";
      if (target.center) {
        labelEl.classList.add("center");
        labelEl.style.left = `${rect.left + rect.width / 2}px`;
        labelEl.style.top = `${rect.top + rect.height / 2}px`;
      } else {
        labelEl.style.left = `${rect.left + CORNER_INSET_PX}px`;
        labelEl.style.top = `${rect.top + CORNER_INSET_PX}px`;
      }
      entries.set(label, { target, labelEl });
      layerEl.append(labelEl);
    }
    layerEl.hidden = false;
    paint();
    return true;
  }

  function handleKeydown(e: HintKeyboardEvent): boolean {
    if (entries.size === 0) return false;
    const key = e.key;
    if (MODIFIER_KEY_NAMES.has(key)) return true;
    // 修飾キー付きの打鍵はヒントの絞り込みではないので、モードごと畳んで本来の操作へ譲る
    // （その打鍵自体は捨てる。prefixキー等が意図せず二重に効くのを避けるため）
    if (e.metaKey || e.ctrlKey || e.altKey || key === "Escape") {
      exit();
      return true;
    }
    if (key === "Backspace") {
      if (typed.length === 0) exit();
      else {
        typed = typed.slice(0, -1);
        paint();
      }
      return true;
    }
    if (key.length !== 1) {
      exit();
      return true;
    }
    const next = typed + key.toLowerCase();
    const match = matchHintInput(entries.keys(), next);
    if (match.kind === "none") {
      exit();
      return true;
    }
    if (match.kind === "pending") {
      typed = next;
      paint();
      return true;
    }
    const jump = entries.get(match.label)?.target.jump;
    exit();
    jump?.();
    return true;
  }

  return {
    isActive: () => entries.size > 0,
    enter,
    exit,
    handleKeydown,
  };
}
