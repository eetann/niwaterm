// タイル操作のキーバインド。niwaterm.config.tsで自由に変更できる（compileKeybindingsでコンパイル済みのテーブルを受け取る）。
// アプリ固有の変換（KeyboardEventLike⇄DSL文字列、KeybindAction⇄TileCommand）をここで担い、
// 汎用的なDSLパース・コンパイルは@niwaterm/configパッケージ側が担う。
//
// tmux風のprefix方式: prefixキー（既定Ctrl+B）を押すと「2打目キー待ち」状態に入り、
// 次のkeydownで2打目キーテーブル（compiled.bindings）を引く。無効なキー・Escapeで
// 待ち状態はキャンセルされる。1回のkeydown処理で完結しないため、状態を保持する
// createKeybindResolverファクトリとして実装する（純粋関数のままでは表現できない）。

import {
  canonicalizeParsed,
  canonicalizeSecondKey,
  type CompiledKeybindings,
  type KeybindAction,
} from "@niwaterm/config";

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
  | { type: "scrollToEdge"; edge: "top" | "bottom" }
  | { type: "commandPalette" }
  | { type: "increaseFontSize" }
  | { type: "decreaseFontSize" }
  | { type: "resetFontSize" };

// keydownイベントから使うプロパティだけを受け取る（テストでモックしやすくするため最小化）
// codeはCmd+Shift+[/]（Shiftで文字自体が変わるためkeyでは判定できない）にのみ使う
export type KeyboardEventLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

export type KeydownResult =
  | { kind: "command"; command: TileCommand }
  // prefix待ち状態への遷移・2打目キー入力・Escapeキャンセルなど、niwatermが処理を握った
  // （呼び出し側はpreventDefaultし、PTYへは何も送らない）
  | { kind: "consumed" }
  // niwatermのキーバインドに該当しない、通常のターミナル入力
  | { kind: "passthrough" };

export interface KeybindResolver {
  handleKeydown(e: KeyboardEventLike): KeydownResult;
  /** prefix入力後、2打目キー待ちの状態かどうか（UIインジケータ表示用） */
  isAwaitingSecondKey(): boolean;
  /** 2打目キー待ち状態を強制的に解除する（ウィンドウのフォーカス喪失時などに使う） */
  reset(): void;
}

// ブラウザは修飾キー単体でもkeydownを発火する（例: Shiftだけ押すとe.key === "Shift"）。
// 2打目キー待ち中にこれを拾ってしまうと「shift+d」のような組み合わせの前半で
// 待ち状態がキャンセルされてしまうため、無視して待ち状態を維持する。
const MODIFIER_KEY_NAMES = new Set(["Shift", "Control", "Alt", "Meta"]);

// @niwaterm/configのKeyBindingString表記（"up"/"["/"]"等）にキー本体を正規化する。
// ブラケット・バッククォートのみcodeで判定する（Shiftで文字自体が変わる
// （例: ` → ~）ためe.keyでは判定できない。toggle-popupの既定"`"がこれに該当する）。
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

function keyboardEventToSecondKeyCanonical(e: KeyboardEventLike): string {
  return canonicalizeSecondKey({
    shift: e.shiftKey,
    alt: e.altKey,
    key: keyBodyFromEvent(e),
  });
}

export function actionToTileCommand(action: KeybindAction): TileCommand {
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
    case "command-palette":
      return { type: "commandPalette" };
    case "increase-font-size":
      return { type: "increaseFontSize" };
    case "decrease-font-size":
      return { type: "decreaseFontSize" };
    case "reset-font-size":
      return { type: "resetFontSize" };
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown keybind action: ${String(exhaustive)}`);
    }
  }
}

export function createKeybindResolver(compiled: CompiledKeybindings): KeybindResolver {
  let awaitingSecondKey = false;

  function matchesPrefix(e: KeyboardEventLike): boolean {
    return (
      compiled.prefix !== null &&
      keyboardEventToCanonical(e) === canonicalizeParsed(compiled.prefix)
    );
  }

  function handleKeydown(e: KeyboardEventLike): KeydownResult {
    if (awaitingSecondKey) {
      if (MODIFIER_KEY_NAMES.has(e.key)) return { kind: "consumed" };
      awaitingSecondKey = false;
      if (e.key === "Escape") return { kind: "consumed" };
      const action = compiled.bindings.get(keyboardEventToSecondKeyCanonical(e));
      return action
        ? { kind: "command", command: actionToTileCommand(action) }
        : { kind: "consumed" };
    }

    if (!MODIFIER_KEY_NAMES.has(e.key) && matchesPrefix(e)) {
      awaitingSecondKey = true;
      return { kind: "consumed" };
    }

    // cmdもctrlも伴わないキーはターミナルへの通常入力に予約されている
    if (e.metaKey || e.ctrlKey) {
      const action = compiled.direct.get(keyboardEventToCanonical(e));
      if (action) return { kind: "command", command: actionToTileCommand(action) };
    }

    return { kind: "passthrough" };
  }

  return {
    handleKeydown,
    isAwaitingSecondKey: () => awaitingSecondKey,
    reset: () => {
      awaitingSecondKey = false;
    },
  };
}
