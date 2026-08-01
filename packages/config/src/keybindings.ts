// キーバインドDSL: "cmd+d", "cmd+shift+d", "cmd+alt+up" のように
// 修飾子(cmd/shift/alt)+...+キー本体 を "+" 区切りで表現する。
// niwatermの全キー操作はCmd必須（Cmdなしのキーはターミナルへの通常入力に予約されているため）。
// ctrl修飾子は既存機能が使っていないため今回は型に含めない（将来の拡張点）。

type ModifierToken = "cmd" | "shift" | "alt";

const MODIFIER_TOKENS: ReadonlySet<string> = new Set<ModifierToken>(["cmd", "shift", "alt"]);

export type KeyBindingString =
  | `${ModifierToken}+${string}`
  | `${ModifierToken}+${ModifierToken}+${string}`
  | `${ModifierToken}+${ModifierToken}+${ModifierToken}+${string}`;

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
] as const;

export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

export type KeybindingsConfig = Partial<Record<KeyBindingString, KeybindAction>>;

// 既存のtile-keybindings.tsのハードコード実装と1:1対応するデフォルト値
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

export interface ParsedKeyBinding {
  cmd: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** "Cmd+Shift+D" のような表記も許容する寛容パーサ。Cmdを含まない・キー本体が空・未知の修飾子はnull */
export function parseKeyBindingString(binding: string): ParsedKeyBinding | null {
  const tokens = binding.split("+").map((t) => t.trim().toLowerCase());
  const key = tokens.at(-1);
  if (!key) return null;
  const modifierTokens = tokens.slice(0, -1);
  const modifiers = new Set(modifierTokens);
  for (const m of modifiers) {
    if (!MODIFIER_TOKENS.has(m)) return null;
  }
  if (!modifiers.has("cmd")) return null;
  return {
    cmd: true,
    shift: modifiers.has("shift"),
    alt: modifiers.has("alt"),
    key,
  };
}

/** compileKeybindingsのMapキーに使う正規化文字列を生成する */
export function canonicalizeParsed(p: ParsedKeyBinding): string {
  return `${p.cmd ? 1 : 0}${p.shift ? 1 : 0}${p.alt ? 1 : 0}:${p.key}`;
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
