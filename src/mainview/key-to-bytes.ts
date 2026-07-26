// keydownイベントから使うプロパティだけを受け取る（テストでモックしやすくするため最小化）
export type KeyboardEventLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">;

// ---- キー入力 → PTYバイト列 ----
export function keyToBytes(e: KeyboardEventLike): string | null {
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
