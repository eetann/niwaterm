// タイル操作のキーバインド。niwaterm.config.tsで自由に変更できる（compileKeybindingsでコンパイル済みのテーブルを受け取る）。
// アプリ固有の変換（KeyboardEventLike⇄DSL文字列、KeybindAction⇄TileCommand）をここで担い、
// 汎用的なDSLパース・コンパイルは@niwaterm/configパッケージ側が担う。

import { canonicalizeParsed, type KeybindAction } from "@niwaterm/config";

export type TileCommand =
  | { type: "split"; orientation: "horizontal" | "vertical" }
  | { type: "close" }
  | { type: "focus"; direction: "up" | "down" | "left" | "right" }
  | { type: "newTab" }
  | { type: "newBrowserTab" }
  | { type: "newCustomViewTab" }
  | { type: "cycleTab"; delta: 1 | -1 }
  | { type: "newWorkspace" }
  | { type: "switchWorkspace"; delta: 1 | -1 }
  | { type: "toggleSidebar" }
  | { type: "togglePopup" }
  | { type: "copySelection" }
  | { type: "pasteClipboard" }
  | { type: "scrollPage"; direction: "up" | "down" }
  | { type: "scrollToEdge"; edge: "top" | "bottom" };

// keydownイベントから使うプロパティだけを受け取る（テストでモックしやすくするため最小化）
// codeはCmd+Shift+[/]（Shiftで文字自体が変わるためkeyでは判定できない）にのみ使う
export type KeyboardEventLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

// @niwaterm/configのKeyBindingString表記（"up"/"["/"]"等）にキー本体を正規化する。
// ブラケット・バッククォートのみcodeで判定する（Shiftで文字自体が変わる
// （例: ` → ~）ためe.keyでは判定できない。toggle-popupのWindows既定"ctrl+shift+`"がこれに該当する）。
function keyBodyFromEvent(e: KeyboardEventLike): string {
  if (e.code === "BracketRight") return "]";
  if (e.code === "BracketLeft") return "[";
  if (e.code === "Backquote") return "`";
  switch (e.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    default:
      return e.key.toLowerCase();
  }
}

function keyboardEventToCanonical(e: KeyboardEventLike): string {
  return canonicalizeParsed({
    cmd: e.metaKey,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key: keyBodyFromEvent(e),
  });
}

function actionToTileCommand(action: KeybindAction): TileCommand {
  switch (action) {
    case "split-vertical":
      return { type: "split", orientation: "vertical" };
    case "split-horizontal":
      return { type: "split", orientation: "horizontal" };
    case "close-tile":
      return { type: "close" };
    case "focus-up":
      return { type: "focus", direction: "up" };
    case "focus-down":
      return { type: "focus", direction: "down" };
    case "focus-left":
      return { type: "focus", direction: "left" };
    case "focus-right":
      return { type: "focus", direction: "right" };
    case "new-tab":
      return { type: "newTab" };
    case "new-browser-tab":
      return { type: "newBrowserTab" };
    case "new-custom-view-tab":
      return { type: "newCustomViewTab" };
    case "next-tab":
      return { type: "cycleTab", delta: 1 };
    case "prev-tab":
      return { type: "cycleTab", delta: -1 };
    case "new-workspace":
      return { type: "newWorkspace" };
    case "next-workspace":
      return { type: "switchWorkspace", delta: 1 };
    case "prev-workspace":
      return { type: "switchWorkspace", delta: -1 };
    case "toggle-sidebar":
      return { type: "toggleSidebar" };
    case "toggle-popup":
      return { type: "togglePopup" };
    case "copy-selection":
      return { type: "copySelection" };
    case "paste-clipboard":
      return { type: "pasteClipboard" };
    case "scroll-page-up":
      return { type: "scrollPage", direction: "up" };
    case "scroll-page-down":
      return { type: "scrollPage", direction: "down" };
    case "scroll-to-top":
      return { type: "scrollToEdge", edge: "top" };
    case "scroll-to-bottom":
      return { type: "scrollToEdge", edge: "bottom" };
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown keybind action: ${String(exhaustive)}`);
    }
  }
}

export function resolveTileCommand(
  e: KeyboardEventLike,
  compiled: ReadonlyMap<string, KeybindAction>,
): TileCommand | null {
  // cmdもctrlも伴わないキーはターミナルへの通常入力に予約されている
  if (!e.metaKey && !e.ctrlKey) return null;
  const action = compiled.get(keyboardEventToCanonical(e));
  return action ? actionToTileCommand(action) : null;
}
