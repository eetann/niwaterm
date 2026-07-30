// tmux send-keys相当のキー名→PTY送信バイト列変換。
// src/mainview/key-to-bytes.tsはDOMのKeyboardEvent由来で入力形状が異なるため独立実装
// （対応するバイト列の値そのものは共通）。

const SPECIAL_KEYS: Record<string, string> = {
  Enter: "\r",
  Escape: "\x1b",
  Tab: "\t",
  Space: " ",
  BSpace: "\x7f",
  Up: "\x1b[A",
  Down: "\x1b[B",
  Right: "\x1b[C",
  Left: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  Delete: "\x1b[3~",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
};

const CTRL_KEY_RE = /^C-([A-Za-z])$/;

/** 特殊キー名（Enter/C-c等）ならバイト列へ変換し、それ以外はリテラル文字列としてそのまま返す */
export function tmuxKeyToBytes(token: string): string {
  const special = SPECIAL_KEYS[token];
  if (special !== undefined) return special;
  const ctrlMatch = token.match(CTRL_KEY_RE);
  if (ctrlMatch) {
    const letter = ctrlMatch[1] as string;
    const code = letter.toUpperCase().charCodeAt(0);
    return String.fromCharCode(code & 0x1f);
  }
  return token;
}

export function tmuxKeysToBytes(tokens: string[]): string {
  return tokens.map(tmuxKeyToBytes).join("");
}
