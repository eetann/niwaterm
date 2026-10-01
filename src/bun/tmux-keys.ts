// tmux send-keys相当のキー名→PTY送信バイト列変換。
// src/mainview/key-to-bytes.tsはDOMのKeyboardEvent由来で入力形状が異なるため独立実装
// （対応するバイト列の値そのものは共通）。

const SPECIAL_KEYS: Record<string, string> = {
  Enter: "\r",
  Escape: "\x1b",
  Tab: "\t",
  Space: " ",
  BSpace: "\x7f",
};

// 修飾キーを付けられる特殊キー。xtermのCSIパラメータ形式で、カーソルキー・Home/Endは
// "ESC [ 1 ; <mod> <終端文字>"、Delete/PageUp/PageDownは"ESC [ <n> ; <mod> ~"になる
const CSI_FINAL_KEYS: Record<string, string> = {
  Up: "A",
  Down: "B",
  Right: "C",
  Left: "D",
  Home: "H",
  End: "F",
};

const CSI_TILDE_KEYS: Record<string, number> = {
  Delete: 3,
  PageUp: 5,
  PageDown: 6,
};

// 英字のほか`[`・`]`・`\`・`^`・`_`も受け付ける。いずれもASCIIコードを0x1fで
// マスクすると対応する制御バイトになる（`C-]`なら0x1d）
const CTRL_KEY_RE = /^C-([A-Za-z[\]\\^_])$/;

/** tmuxと同じ`C-`・`M-`・`S-`の前置（重ねがけ可）と、その後ろのキー名 */
const MODIFIED_KEY_RE = /^((?:[CMS]-)*)([A-Za-z]+)$/;

/** xtermの修飾パラメータ。shift=1・alt=2・ctrl=4のビット和に1を足した値 */
function modifierParam(prefixes: string): number {
  return (
    1 +
    (prefixes.includes("S-") ? 1 : 0) +
    (prefixes.includes("M-") ? 2 : 0) +
    (prefixes.includes("C-") ? 4 : 0)
  );
}

/** カーソル系の特殊キー名（修飾付きを含む）ならバイト列へ変換する。該当しなければnull */
function csiKeyToBytes(token: string): string | null {
  const match = token.match(MODIFIED_KEY_RE);
  if (!match) return null;
  const mod = modifierParam(match[1] as string);
  const name = match[2] as string;
  const final = CSI_FINAL_KEYS[name];
  if (final !== undefined) return mod === 1 ? `\x1b[${final}` : `\x1b[1;${mod}${final}`;
  const tilde = CSI_TILDE_KEYS[name];
  if (tilde !== undefined) return mod === 1 ? `\x1b[${tilde}~` : `\x1b[${tilde};${mod}~`;
  return null;
}

/** 特殊キー名（Enter/C-c/C-End等）ならバイト列へ変換し、それ以外はリテラル文字列としてそのまま返す */
export function tmuxKeyToBytes(token: string): string {
  const special = SPECIAL_KEYS[token];
  if (special !== undefined) return special;
  const csi = csiKeyToBytes(token);
  if (csi !== null) return csi;
  const ctrlMatch = token.match(CTRL_KEY_RE);
  if (ctrlMatch) {
    const key = ctrlMatch[1] as string;
    return String.fromCharCode(key.toUpperCase().charCodeAt(0) & 0x1f);
  }
  return token;
}

export function tmuxKeysToBytes(tokens: string[]): string {
  return tokens.map(tmuxKeyToBytes).join("");
}
