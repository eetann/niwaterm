// タイル操作のキーバインド。niwaterm.config.tsで自由に変更できる（compileKeybindingsでコンパイル済みのテーブルを受け取る）。
// アプリ固有の変換（KeyboardEventLike⇄DSL文字列、KeybindAction⇄TileCommand）をここで担い、
// 汎用的なDSLパース・コンパイルは@niwaterm/configパッケージ側が担う。
//
// tmux風のprefix方式: prefixキー（既定Ctrl+B）を押すと「2打目キー待ち」状態に入り、
// 次のkeydownで2打目キーテーブル（compiled.bindings）を引く。無効なキー・Escapeで
// 待ち状態はキャンセルされる。1回のkeydown処理で完結しないため、状態を保持する
// createKeybindResolverファクトリとして実装する（純粋関数のままでは表現できない）。

import {
  type BindingTarget,
  canonicalizeParsed,
  canonicalizeSecondKey,
  type CompiledKeybindings,
  isCustomBindingRef,
  type KeybindAction,
} from "@niwaterm/config";

// keydown駆動でrepeat窓のタイムアウトを判定する（setTimeoutは使わない）ためのテスト用時刻注入。
// 省略時はDate.now
export type NowFn = () => number;

export type TileCommand =
  | { type: "split"; orientation: "horizontal" | "vertical" }
  | { type: "close" }
  | { type: "focus"; direction: "up" | "down" | "left" | "right" }
  | { type: "resize"; direction: "up" | "down" | "left" | "right" }
  | { type: "toggleZoom" }
  // niwa.keybindに関数ハンドラを渡したエントリ。実際の処理はbun側のniwa-api.tsで行う
  | { type: "custom"; handlerId: string }
  | { type: "newTab" }
  | { type: "newBrowserTab" }
  | { type: "newCustomViewTab" }
  | { type: "cycleTab"; delta: 1 | -1 }
  | { type: "renameTab" }
  | { type: "restartTab" }
  | { type: "newWorkspace" }
  | { type: "newWindow" }
  | { type: "switchBoard"; delta: 1 | -1 }
  | { type: "moveBoard"; delta: 1 | -1 }
  | { type: "moveBoardToWorkspace" }
  | { type: "renameBoard" }
  | { type: "setBoardWorktree" }
  | { type: "switchWorkspace"; delta: 1 | -1 }
  | { type: "moveWorkspace"; delta: 1 | -1 }
  | { type: "toggleSidebar" }
  | { type: "togglePopup" }
  | { type: "jumpHint" }
  | { type: "copySelection" }
  | { type: "copyMode" }
  | { type: "pasteClipboard" }
  | { type: "scrollPage"; direction: "up" | "down" }
  | { type: "scrollToEdge"; edge: "top" | "bottom" }
  | { type: "commandPalette" }
  | { type: "increaseFontSize" }
  | { type: "decreaseFontSize" }
  | { type: "resetFontSize" }
  | { type: "reloadConfig" }
  | { type: "showConfig" };

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
  /** repeat:trueなバインドの発火直後、prefix無しで連打できる窓が開いているかどうか（UIインジケータ表示用） */
  isRepeating(): boolean;
  /** 2打目キー待ち・リピート窓を強制的に解除する（ウィンドウのフォーカス喪失時などに使う） */
  reset(): void;
}

// ブラウザは修飾キー単体でもkeydownを発火する（例: Shiftだけ押すとe.key === "Shift"）。
// 2打目キー待ち中にこれを拾ってしまうと「shift+d」のような組み合わせの前半で
// 待ち状態がキャンセルされてしまうため、無視して待ち状態を維持する。
const MODIFIER_KEY_NAMES = new Set(["Shift", "Control", "Alt", "Meta"]);

// macOSのOptionキーは「修飾」ではなく「別の文字の入力」として扱われるため、Optionを押しながらの
// 英数字キーはe.keyが元の文字にならない（US配列でOption+N → "Dead"、Option+J → "∆"、
// Option+P → "π"等）。tmuxの`bind-key -n M-key`相当をmacOSでも書けるよう、Altを含む場合だけ
// 物理キー位置のe.code（KeyN/Digit1）から文字を復元する。英数字キーはJIS/US等の主要配列で
// 位置が共通なので配列差の影響を受けにくく、逆に記号キーは配列でずれるため対象にしない
// （記号のalt+バインドが要るようになったらここを見直す）。
const ALT_LETTER_CODE = /^Key([A-Z])$/;
const ALT_DIGIT_CODE = /^Digit([0-9])$/;

function altKeyBodyFromCode(code: string): string | null {
  const letter = ALT_LETTER_CODE.exec(code);
  if (letter?.[1]) return letter[1].toLowerCase();
  const digit = ALT_DIGIT_CODE.exec(code);
  if (digit?.[1]) return digit[1];
  return null;
}

// @niwaterm/configのKeyBindingString表記（"up"/"["/"]"等）にキー本体を正規化する。
// ブラケット・バッククォートのみcodeで判定する（Shiftで文字自体が変わる
// （例: ` → ~）ためe.keyでは判定できない。toggle-popupの既定"`"がこれに該当する）。
function keyBodyFromEvent(e: KeyboardEventLike): string {
  if (e.code === "BracketRight") return "]";
  if (e.code === "BracketLeft") return "[";
  if (e.code === "Backquote") return "`";
  if (e.altKey) {
    const fromCode = altKeyBodyFromCode(e.code);
    if (fromCode !== null) return fromCode;
  }
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
    case "resize-up":
      return { type: "resize", direction: "up" };
    case "resize-down":
      return { type: "resize", direction: "down" };
    case "resize-left":
      return { type: "resize", direction: "left" };
    case "resize-right":
      return { type: "resize", direction: "right" };
    case "toggle-zoom":
      return { type: "toggleZoom" };
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
    case "rename-tab":
      return { type: "renameTab" };
    case "restart-tab":
      return { type: "restartTab" };
    case "next-board":
      return { type: "switchBoard", delta: 1 };
    case "prev-board":
      return { type: "switchBoard", delta: -1 };
    case "move-board-up":
      return { type: "moveBoard", delta: -1 };
    case "move-board-down":
      return { type: "moveBoard", delta: 1 };
    case "move-board-to-workspace":
      return { type: "moveBoardToWorkspace" };
    case "rename-board":
      return { type: "renameBoard" };
    case "set-board-worktree":
      return { type: "setBoardWorktree" };
    case "new-workspace":
      return { type: "newWorkspace" };
    case "new-window":
      return { type: "newWindow" };
    case "next-workspace":
      return { type: "switchWorkspace", delta: 1 };
    case "prev-workspace":
      return { type: "switchWorkspace", delta: -1 };
    case "move-workspace-up":
      return { type: "moveWorkspace", delta: -1 };
    case "move-workspace-down":
      return { type: "moveWorkspace", delta: 1 };
    case "toggle-sidebar":
      return { type: "toggleSidebar" };
    case "toggle-popup":
      return { type: "togglePopup" };
    case "jump-hint":
      return { type: "jumpHint" };
    case "copy-selection":
      return { type: "copySelection" };
    case "copy-mode":
      return { type: "copyMode" };
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
    case "reload-config":
      return { type: "reloadConfig" };
    case "show-config":
      return { type: "showConfig" };
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown keybind action: ${String(exhaustive)}`);
    }
  }
}

/** BindingTargetがcustom（niwa.keybindに渡した関数ハンドラ）ならcustom TileCommandへ、それ以外はactionToTileCommandへ委譲する */
export function bindingTargetToTileCommand(target: BindingTarget): TileCommand {
  if (isCustomBindingRef(target)) return { type: "custom", handlerId: target.id };
  return actionToTileCommand(target);
}

export interface CreateKeybindResolverOptions {
  /** テスト用の時刻注入。省略時はDate.now */
  now?: NowFn;
}

/**
 * tmuxのbind-key -r相当のリピート機構。repeat:trueなバインドが発火すると、以後repeatTimeoutMs以内は
 * 同じ2打目キーテーブル（compiled.bindings）をprefix無しで引ける（別のrepeatableキーへの切替も可）。
 * setTimeoutは使わず、次に来たkeydown時点でnow()と締切を比較するkeydown駆動の方式にする
 * （handleKeydownを純粋な同期関数のまま保つため）。
 */
export function createKeybindResolver(
  compiled: CompiledKeybindings,
  opts: CreateKeybindResolverOptions = {},
): KeybindResolver {
  const now = opts.now ?? Date.now;
  let awaitingSecondKey = false;
  let repeatDeadline: number | null = null;

  function matchesPrefix(e: KeyboardEventLike): boolean {
    return (
      compiled.prefix !== null &&
      keyboardEventToCanonical(e) === canonicalizeParsed(compiled.prefix)
    );
  }

  // 2打目キー待ちでない時、リピート窓が有効ならprefix無しで同じテーブルを引く。
  // 窓の外・未割当・repeat無しのエントリはrepeatDeadlineをクリアして通常フローへフォールスルーする
  function tryRepeat(e: KeyboardEventLike): KeydownResult | null {
    if (repeatDeadline === null) return null;
    if (MODIFIER_KEY_NAMES.has(e.key)) return null;
    if (now() > repeatDeadline) {
      repeatDeadline = null;
      return null;
    }
    const entry = compiled.bindings.get(keyboardEventToSecondKeyCanonical(e));
    if (!entry || !entry.repeat) {
      repeatDeadline = null;
      return null;
    }
    repeatDeadline = now() + compiled.repeatTimeoutMs;
    return { kind: "command", command: bindingTargetToTileCommand(entry.target) };
  }

  function handleKeydown(e: KeyboardEventLike): KeydownResult {
    if (awaitingSecondKey) {
      if (MODIFIER_KEY_NAMES.has(e.key)) return { kind: "consumed" };
      awaitingSecondKey = false;
      if (e.key === "Escape") {
        repeatDeadline = null;
        return { kind: "consumed" };
      }
      const entry = compiled.bindings.get(keyboardEventToSecondKeyCanonical(e));
      if (!entry) {
        repeatDeadline = null;
        return { kind: "consumed" };
      }
      repeatDeadline = entry.repeat ? now() + compiled.repeatTimeoutMs : null;
      return { kind: "command", command: bindingTargetToTileCommand(entry.target) };
    }

    // prefixキー自体はリピート窓より優先する。2打目キーはshift/altしか見ないため、
    // prefix（例: ctrl+b）のkeydownをそのままcompiled.bindingsに引くとctrl修飾を無視して
    // 誤マッチしうる（例: bの2打目キーにrepeat:trueが設定されている場合）
    if (!MODIFIER_KEY_NAMES.has(e.key) && matchesPrefix(e)) {
      awaitingSecondKey = true;
      repeatDeadline = null;
      return { kind: "consumed" };
    }

    const repeated = tryRepeat(e);
    if (repeated) return repeated;

    // cmd/ctrl/altのいずれも伴わないキーはターミナルへの通常入力に予約されている
    if (e.metaKey || e.ctrlKey || e.altKey) {
      const entry = compiled.direct.get(keyboardEventToCanonical(e));
      if (entry) return { kind: "command", command: bindingTargetToTileCommand(entry.target) };
    }

    return { kind: "passthrough" };
  }

  return {
    handleKeydown,
    isAwaitingSecondKey: () => awaitingSecondKey,
    isRepeating: () => repeatDeadline !== null && now() <= repeatDeadline,
    reset: () => {
      awaitingSecondKey = false;
      repeatDeadline = null;
    },
  };
}
