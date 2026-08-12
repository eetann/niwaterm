// キーバインドDSL: "cmd+d", "cmd+shift+d", "ctrl+shift+d" のように
// 修飾子(cmd/ctrl/shift/alt)+...+キー本体 を "+" 区切りで表現する。
// niwatermの全キー操作はcmdまたはctrlが必須（修飾なしのキーはターミナルへの通常入力に予約されているため）。
// macOSはcmd、Windowsはctrl+shiftを基本とする（Windowsのcmd=Windowsキーは実用にならず、
// またctrl単独はCtrl+C/Ctrl+D等のターミナル制御文字と衝突するため）。

type ModifierToken = "cmd" | "ctrl" | "shift" | "alt";

const MODIFIER_TOKENS: ReadonlySet<string> = new Set<ModifierToken>([
  "cmd",
  "ctrl",
  "shift",
  "alt",
]);

export type KeyBindingString =
  | `${ModifierToken}+${string}`
  | `${ModifierToken}+${ModifierToken}+${string}`
  | `${ModifierToken}+${ModifierToken}+${ModifierToken}+${string}`
  | `${ModifierToken}+${ModifierToken}+${ModifierToken}+${ModifierToken}+${string}`;

export const KEYBIND_ACTIONS = [
  "split-vertical",
  "split-horizontal",
  "close-tile",
  "focus-up",
  "focus-down",
  "focus-left",
  "focus-right",
  "new-tab",
  "new-browser-tab",
  "new-custom-view-tab",
  "next-tab",
  "prev-tab",
  "new-workspace",
  "next-workspace",
  "prev-workspace",
  "toggle-sidebar",
  "copy-selection",
  "paste-clipboard",
] as const;

export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

export type KeybindingsConfig = Partial<Record<KeyBindingString, KeybindAction>>;

// 既存のtile-keybindings.tsのハードコード実装と1:1対応するデフォルト値（macOS）
export const defaultKeybindings: KeybindingsConfig = {
  "cmd+d": "split-vertical",
  "cmd+shift+d": "split-horizontal",
  "cmd+w": "close-tile",
  "cmd+alt+up": "focus-up",
  "cmd+alt+down": "focus-down",
  "cmd+alt+left": "focus-left",
  "cmd+alt+right": "focus-right",
  "cmd+t": "new-tab",
  "cmd+shift+t": "new-browser-tab",
  "cmd+shift+]": "next-tab",
  "cmd+shift+[": "prev-tab",
  "cmd+n": "new-workspace",
  "cmd+alt+]": "next-workspace",
  "cmd+alt+[": "prev-workspace",
  "cmd+b": "toggle-sidebar",
};

// Windowsのデフォルト。ctrl+shiftを基本とし、Ctrl+C/Ctrl+D/Ctrl+B等はターミナルへ素通りさせる。
// macOSでshiftによって対にしている操作（分割方向・タブ種別）は、
// ctrl+shiftが埋まっているぶんghosttyのWindows/Linux慣習に寄せたキーへ割り当てる。
export const defaultWindowsKeybindings: KeybindingsConfig = {
  "ctrl+shift+d": "split-vertical",
  "ctrl+shift+e": "split-horizontal",
  "ctrl+shift+w": "close-tile",
  "ctrl+alt+up": "focus-up",
  "ctrl+alt+down": "focus-down",
  "ctrl+alt+left": "focus-left",
  "ctrl+alt+right": "focus-right",
  "ctrl+shift+t": "new-tab",
  "ctrl+shift+alt+t": "new-browser-tab",
  "ctrl+shift+]": "next-tab",
  "ctrl+shift+[": "prev-tab",
  "ctrl+shift+n": "new-workspace",
  "ctrl+alt+]": "next-workspace",
  "ctrl+alt+[": "prev-workspace",
  "ctrl+shift+b": "toggle-sidebar",
  // Ctrl+C/Ctrl+VはSIGINT/制御文字としてターミナルへ素通りさせるため、
  // Windows Terminal等の慣習に倣いctrl+shiftをコピー・ペーストに割り当てる
  "ctrl+shift+c": "copy-selection",
  "ctrl+shift+v": "paste-clipboard",
};

/** 実行プラットフォームに対応するデフォルトキーバインド（値はprocess.platformと同じ表記） */
export function platformDefaultKeybindings(platform: string): KeybindingsConfig {
  return platform === "win32" ? defaultWindowsKeybindings : defaultKeybindings;
}

export interface ParsedKeyBinding {
  cmd: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/**
 * "Cmd+Shift+D" のような表記も許容する寛容パーサ。
 * cmdもctrlも含まない・キー本体が空・未知の修飾子はnull
 */
export function parseKeyBindingString(binding: string): ParsedKeyBinding | null {
  const tokens = binding.split("+").map((t) => t.trim().toLowerCase());
  const key = tokens.at(-1);
  if (!key) return null;
  const modifierTokens = tokens.slice(0, -1);
  const modifiers = new Set(modifierTokens);
  for (const m of modifiers) {
    if (!MODIFIER_TOKENS.has(m)) return null;
  }
  if (!modifiers.has("cmd") && !modifiers.has("ctrl")) return null;
  return {
    cmd: modifiers.has("cmd"),
    ctrl: modifiers.has("ctrl"),
    shift: modifiers.has("shift"),
    alt: modifiers.has("alt"),
    key,
  };
}

/** compileKeybindingsのMapキーに使う正規化文字列を生成する（cmd/ctrl/shift/altの順） */
export function canonicalizeParsed(p: ParsedKeyBinding): string {
  return `${p.cmd ? 1 : 0}${p.ctrl ? 1 : 0}${p.shift ? 1 : 0}${p.alt ? 1 : 0}:${p.key}`;
}

export function isKeybindAction(value: unknown): value is KeybindAction {
  return typeof value === "string" && (KEYBIND_ACTIONS as readonly string[]).includes(value);
}

/** 不正なバインド文字列・未知のアクション名のエントリは黙ってスキップする */
export function compileKeybindings(config: KeybindingsConfig): Map<string, KeybindAction> {
  const compiled = new Map<string, KeybindAction>();
  for (const [binding, action] of Object.entries(config)) {
    if (action === undefined) continue;
    const parsed = parseKeyBindingString(binding);
    if (!parsed || !isKeybindAction(action)) continue;
    compiled.set(canonicalizeParsed(parsed), action);
  }
  return compiled;
}
