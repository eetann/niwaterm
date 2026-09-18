// keydownイベントから使うプロパティだけを受け取る（テストでモックしやすくするため最小化）
export type KeyboardEventLike = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

// 修飾キー付きの特殊キーはxtermのCSIパラメータ形式で送る。終端文字で区別する2系統があり、
// カーソルキー・Home/Endは"ESC [ 1 ; <mod> <終端文字>"、Delete/PageUp/PageDownは
// "ESC [ <n> ; <mod> ~"。修飾なしの時はパラメータ自体を省いた短い形を送る（"ESC [ A"等）
const CSI_FINAL_KEYS = new Map<string, string>([
  ["ArrowUp", "A"],
  ["ArrowDown", "B"],
  ["ArrowRight", "C"],
  ["ArrowLeft", "D"],
  ["Home", "H"],
  ["End", "F"],
]);

const CSI_TILDE_KEYS = new Map<string, number>([
  ["Delete", 3],
  ["PageUp", 5],
  ["PageDown", 6],
]);

// xtermの修飾パラメータ。shift=1・alt=2・ctrl=4のビット和に1を足した値で、
// 修飾なしの1はパラメータを省略できる
function modifierParam(e: KeyboardEventLike): number {
  return 1 + (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0);
}

// ---- キー入力 → PTYバイト列 ----
export function keyToBytes(e: KeyboardEventLike): string | null {
  // cmd系はアプリ/OSのショートカットに譲る
  if (e.metaKey) return null;

  const mod = modifierParam(e);

  const final = CSI_FINAL_KEYS.get(e.key);
  if (final !== undefined) {
    return mod === 1 ? `\x1b[${final}` : `\x1b[1;${mod}${final}`;
  }

  const tilde = CSI_TILDE_KEYS.get(e.key);
  if (tilde !== undefined) {
    return mod === 1 ? `\x1b[${tilde}~` : `\x1b[${tilde};${mod}~`;
  }

  switch (e.key) {
    case "Enter":
      return e.altKey ? "\x1b\r" : "\r";
    case "Backspace":
      // Alt+Backspaceはreadline等の「直前の単語を削除」に割り当てられている
      return e.altKey ? "\x1b\x7f" : "\x7f";
    case "Tab":
      // Shift+Tabは逆方向の補完・フォーカス移動に使われるバックタブ
      if (e.shiftKey) return "\x1b[Z";
      return e.altKey ? "\x1b\t" : "\t";
    case "Escape":
      return "\x1b";
  }

  if (e.key.length === 1) {
    // Ctrl+英字 → 制御文字 (Ctrl+A = 0x01)
    if (e.ctrlKey) {
      const code = e.key.toUpperCase().charCodeAt(0);
      if (code >= 64 && code < 128) {
        const ctrlByte = String.fromCharCode(code & 0x1f);
        return e.altKey ? `\x1b${ctrlByte}` : ctrlByte;
      }
      return null;
    }
    // Alt+キーはESCプレフィックス付きで送る（readlineのMeta相当）。macOSのOptionは修飾ではなく
    // 代替文字の入力になり、e.keyが非ASCII（Option+P → "π"）やデッドキーへ化けるため、
    // ASCII可視文字の時だけプレフィックスを付けて代替文字の入力自体は壊さないようにする
    if (e.altKey) {
      const code = e.key.charCodeAt(0);
      return code >= 0x20 && code < 0x7f ? `\x1b${e.key}` : e.key;
    }
    return e.key;
  }
  return null;
}
