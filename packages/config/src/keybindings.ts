// キーバインドDSL: tmux風のprefix方式。
// prefixキー（例: "ctrl+b"）を押してから、修飾なし〜shift/altのみの単一キー（例: "d", "shift+d", "up"）を
// 押すとアクションが発火する。prefixキー自体はcmd/ctrl/shift/altの組み合わせで表現する（"cmd+d"等と同じDSL）。
// prefix・2打目キーの表記に加え、頻用操作（コピー・ペースト）向けに即時発火する`direct`ショートカット
// （cmd/ctrl必須、修飾なしのキーはターミナルへの通常入力に予約されているため）も別枠で持てる。

type ModifierToken = "cmd" | "ctrl" | "shift" | "alt";

const MODIFIER_TOKENS: ReadonlySet<string> = new Set<ModifierToken>([
  "cmd",
  "ctrl",
  "shift",
  "alt",
]);

// prefix・directで使うDSL（cmd/ctrl必須）
export type KeyBindingString =
  | `${ModifierToken}+${string}`
  | `${ModifierToken}+${ModifierToken}+${string}`
  | `${ModifierToken}+${ModifierToken}+${ModifierToken}+${string}`
  | `${ModifierToken}+${ModifierToken}+${ModifierToken}+${ModifierToken}+${string}`;

// prefix入力後の2打目キー表記（修飾子はshift/altのみ、省略可）。例: "d", "shift+d", "up"
export type SecondKeyString = string;

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
  "toggle-popup",
  "copy-selection",
  "paste-clipboard",
  "scroll-page-up",
  "scroll-page-down",
  "scroll-to-top",
  "scroll-to-bottom",
  "command-palette",
] as const;

export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

export interface KeybindingsConfig {
  /** prefixキー本体。例: "ctrl+b" */
  prefix?: KeyBindingString;
  /** prefix入力後に押す2打目キー→アクションのマップ */
  bindings?: Partial<Record<SecondKeyString, KeybindAction>>;
  /** prefixを介さず即座に発火する直接ショートカット（コピー・ペースト等の頻用操作向け） */
  direct?: Partial<Record<KeyBindingString, KeybindAction>>;
}

// prefix・2打目キーともOS共通（prefixキー自体でOS差異を吸収できるため）。
// directのみOS別（macOSはCmd+C/VがApplicationMenu経由で既に機能するため空、
// WindowsはCtrl+C/Vがターミナルの制御文字と衝突するためCtrl+Shift+C/Vを直接ショートカットとして持つ）。
const commonBindings: Partial<Record<SecondKeyString, KeybindAction>> = {
  d: "split-vertical",
  "shift+d": "split-horizontal",
  w: "close-tile",
  up: "focus-up",
  down: "focus-down",
  left: "focus-left",
  right: "focus-right",
  c: "new-tab",
  "shift+t": "new-browser-tab",
  n: "next-tab",
  p: "prev-tab",
  "shift+n": "new-workspace",
  "]": "next-workspace",
  "[": "prev-workspace",
  b: "toggle-sidebar",
  "`": "toggle-popup",
  ":": "command-palette",
  pageup: "scroll-page-up",
  pagedown: "scroll-page-down",
  home: "scroll-to-top",
  end: "scroll-to-bottom",
};

// 既定のprefixキー。tmux標準のCtrl+bをそのまま踏襲する（prefixキーは全操作の唯一の入り口であり、
// 個別ショートカットに課している「ctrl単独禁止」（Ctrl+C等ターミナル制御文字との衝突回避）は
// 性質上当てはまらないため、OS問わずCtrl+bで統一する）。
export const defaultKeybindings: KeybindingsConfig = {
  prefix: "ctrl+b",
  bindings: commonBindings,
};

export const defaultWindowsKeybindings: KeybindingsConfig = {
  prefix: "ctrl+b",
  bindings: commonBindings,
  direct: {
    "ctrl+shift+c": "copy-selection",
    "ctrl+shift+v": "paste-clipboard",
  },
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
 * "Cmd+Shift+D" のような表記も許容する寛容パーサ（prefix・direct用）。
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

export interface ParsedSecondKey {
  shift: boolean;
  alt: boolean;
  key: string;
}

/**
 * prefix入力後の2打目キー表記のパーサ。修飾子はshift/altのみ許容する
 * （prefix自体で既に主要修飾子を使っているため、2打目はシンプルな単一キー操作に絞る）。
 * 未知の修飾子（cmd/ctrl含む）・キー本体が空はnull
 */
export function parseSecondKeyString(binding: string): ParsedSecondKey | null {
  const tokens = binding.split("+").map((t) => t.trim().toLowerCase());
  const key = tokens.at(-1);
  if (!key) return null;
  const modifierTokens = tokens.slice(0, -1);
  const modifiers = new Set(modifierTokens);
  for (const m of modifiers) {
    if (m !== "shift" && m !== "alt") return null;
  }
  return { shift: modifiers.has("shift"), alt: modifiers.has("alt"), key };
}

/** compileKeybindingsのbindings Mapキーに使う正規化文字列を生成する（shift/altの順） */
export function canonicalizeSecondKey(p: ParsedSecondKey): string {
  return `${p.shift ? 1 : 0}${p.alt ? 1 : 0}:${p.key}`;
}

export function isKeybindAction(value: unknown): value is KeybindAction {
  return typeof value === "string" && (KEYBIND_ACTIONS as readonly string[]).includes(value);
}

export interface CompiledKeybindings {
  /** 未設定・パース不可はnull（prefix機能自体が無効になる） */
  prefix: ParsedKeyBinding | null;
  /** canonicalizeSecondKeyで正規化したキーを持つ、prefix入力後の2打目キー→アクションのマップ */
  bindings: ReadonlyMap<string, KeybindAction>;
  /** canonicalizeParsedで正規化したキーを持つ、即時発火の直接ショートカットのマップ */
  direct: ReadonlyMap<string, KeybindAction>;
}

/** 不正なバインド文字列・未知のアクション名のエントリは黙ってスキップする */
export function compileKeybindings(config: KeybindingsConfig): CompiledKeybindings {
  const prefix = config.prefix !== undefined ? parseKeyBindingString(config.prefix) : null;

  const bindings = new Map<string, KeybindAction>();
  for (const [binding, action] of Object.entries(config.bindings ?? {})) {
    if (action === undefined) continue;
    const parsed = parseSecondKeyString(binding);
    if (!parsed || !isKeybindAction(action)) continue;
    bindings.set(canonicalizeSecondKey(parsed), action);
  }

  const direct = new Map<string, KeybindAction>();
  for (const [binding, action] of Object.entries(config.direct ?? {})) {
    if (action === undefined) continue;
    const parsed = parseKeyBindingString(binding);
    if (!parsed || !isKeybindAction(action)) continue;
    direct.set(canonicalizeParsed(parsed), action);
  }

  return { prefix, bindings, direct };
}
