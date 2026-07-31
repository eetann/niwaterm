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
  | { type: "cycleTab"; delta: 1 | -1 }
  | { type: "newWorkspace" }
  | { type: "switchWorkspace"; delta: 1 | -1 }
  | { type: "toggleSidebar" };

// keydownイベントから使うプロパティだけを受け取る（テストでモックしやすくするため最小化）
// codeはCmd+Shift+[/]（Shiftで文字自体が変わるためkeyでは判定できない）にのみ使う
export type KeyboardEventLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "altKey" | "shiftKey"
>;

// @niwaterm/configのKeyBindingString表記（"up"/"["/"]"等）にキー本体を正規化する。
// ブラケットのみcodeで判定する（Shiftで文字自体が変わるためe.keyでは判定できない）。
function keyBodyFromEvent(e: KeyboardEventLike): string {
  if (e.code === "BracketRight") return "]";
  if (e.code === "BracketLeft") return "[";
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
  if (!e.metaKey) return null;
  const action = compiled.get(keyboardEventToCanonical(e));
  return action ? actionToTileCommand(action) : null;
}
