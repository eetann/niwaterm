// キーバインドDSL: tmux風のprefix方式。
// prefixキー（例: "ctrl+b"）を押してから、修飾なし〜shift/altのみの単一キー（例: "d", "shift+d", "up"）を
// 押すとアクションが発火する。prefixキー自体はcmd/ctrl/shift/altの組み合わせで表現する（"cmd+d"等と同じDSL）。
// prefix・2打目キーの表記に加え、頻用操作（コピー・ペースト）向けに即時発火する`direct`ショートカット
// （cmd/ctrl/altのいずれか必須、修飾なし・shift単独のキーはターミナルへの通常入力に予約されているため）
// も別枠で持てる。altを含むdirectはtmuxの`bind-key -n M-key`相当で、押した瞬間ターミナル側の
// Metaキー入力（bashのreadlineショートカット等）より優先してniwaterm側が横取りする点に注意

type ModifierToken = "cmd" | "ctrl" | "shift" | "alt";

const MODIFIER_TOKENS: ReadonlySet<string> = new Set<ModifierToken>([
  "cmd",
  "ctrl",
  "shift",
  "alt",
]);

// prefix・directで使うDSL（cmd/ctrl/altのいずれか必須）
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
  "resize-up",
  "resize-down",
  "resize-left",
  "resize-right",
  "toggle-zoom",
  "new-tab",
  "new-browser-tab",
  "new-custom-view-tab",
  "next-tab",
  "prev-tab",
  "rename-tab",
  "restart-tab",
  "new-board",
  "close-board",
  "next-board",
  "prev-board",
  "move-board-up",
  "move-board-down",
  "move-board-to-workspace",
  "rename-board",
  "set-board-worktree",
  "clear-board-status",
  "clear-board-startup",
  "new-workspace",
  "rename-workspace",
  "close-workspace",
  "new-window",
  "close-window",
  "next-workspace",
  "prev-workspace",
  "move-workspace-up",
  "move-workspace-down",
  "toggle-sidebar",
  "next-sidebar-view",
  "prev-sidebar-view",
  "toggle-popup",
  "promote-popup",
  "jump-hint",
  "copy-selection",
  "copy-mode",
  "paste-clipboard",
  "scroll-page-up",
  "scroll-page-down",
  "scroll-to-top",
  "scroll-to-bottom",
  "jump-prompt-up",
  "jump-prompt-down",
  "command-palette",
  "increase-font-size",
  "decrease-font-size",
  "reset-font-size",
  "reload-config",
  "show-config",
  "quit-app",
] as const;

/** アクション名と対象idを`:`で繋ぐ形のアクション（例: `show-sidebar-view:notes`）の接頭辞 */
export const SHOW_SIDEBAR_VIEW_PREFIX = "show-sidebar-view:";

/** アクティブBoardへステータスを付けるアクション（例: `set-board-status:review`）の接頭辞 */
export const SET_BOARD_STATUS_PREFIX = "set-board-status:";

/**
 * サイドバーの特定ビューを直接出すアクション。対象idはcustomViewのid（またはワークスペース一覧の
 * `workspaces`）で、設定ファイル側で増減するためKEYBIND_ACTIONSの固定リストには入らない
 */
export type ShowSidebarViewAction = `${typeof SHOW_SIDEBAR_VIEW_PREFIX}${string}`;

/**
 * アクティブBoardのステータスを指定の値へ変えるアクション。対象idはboard.statusesのid
 * （設定ファイル側で増減するためKEYBIND_ACTIONSの固定リストには入らない）。
 * 解除は固定アクションの`clear-board-status`が担う
 */
export type SetBoardStatusAction = `${typeof SET_BOARD_STATUS_PREFIX}${string}`;

export type KeybindAction =
  | (typeof KEYBIND_ACTIONS)[number]
  | ShowSidebarViewAction
  | SetBoardStatusAction;

/** `show-sidebar-view:<id>`ならその対象idを返す。他のアクション・id部分が空ならnull */
export function parseShowSidebarViewAction(action: string): string | null {
  if (!action.startsWith(SHOW_SIDEBAR_VIEW_PREFIX)) return null;
  const viewId = action.slice(SHOW_SIDEBAR_VIEW_PREFIX.length);
  return viewId === "" ? null : viewId;
}

/** `set-board-status:<id>`ならその対象idを返す。他のアクション・id部分が空ならnull */
export function parseSetBoardStatusAction(action: string): string | null {
  if (!action.startsWith(SET_BOARD_STATUS_PREFIX)) return null;
  const statusId = action.slice(SET_BOARD_STATUS_PREFIX.length);
  return statusId === "" ? null : statusId;
}

export interface KeybindingsConfig {
  /** prefixキー本体。例: "ctrl+b" */
  prefix?: KeyBindingString;
  /** prefix入力後に押す2打目キー→アクションのマップ。値は既存アクション名の文字列、またはniwa.keybindに渡した関数ハンドラへの参照 */
  bindings?: Partial<Record<SecondKeyString, BindingEntry>>;
  /** prefixを介さず即座に発火する直接ショートカット（コピー・ペースト等の頻用操作向け） */
  direct?: Partial<Record<KeyBindingString, BindingEntry>>;
  /**
   * repeat:trueを付けたバインドが連打とみなす間隔(ms)。tmuxのrepeat-time相当（bind-key -rのリピート判定に使う）。
   * 未指定・不正値はDEFAULT_REPEAT_TIMEOUT_MS
   */
  repeatTimeoutMs?: number;
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
  // tmux標準のbind-key z resize-pane -Zを踏襲する
  z: "toggle-zoom",
  c: "new-tab",
  "shift+t": "new-browser-tab",
  n: "next-tab",
  p: "prev-tab",
  // tmuxにpane名の概念は無いので踏襲元が無い。rename-boardの","と対で覚えられるよう、
  // 素直にrenameの頭文字を充てる
  r: "rename-tab",
  // tmuxのbind-key , rename-window相当（Boardはtmuxのwindowに対応する）
  ",": "rename-board",
  "shift+n": "new-workspace",
  // 新規作成系はshift+頭文字で揃える（shift+t: browser Tab、shift+n: New workspace）。
  // wはWindowの頭文字で、単独のw（close-tile）とは別枠
  "shift+w": "new-window",
  "]": "next-workspace",
  "[": "prev-workspace",
  b: "toggle-sidebar",
  // サイドバー自体のトグル(b)と同系列で覚えられるようshift+bを充てる。
  // prevは既定キーを持たない（customViewが1つだけならnextの往復で足り、増えたときの直接指定は
  // show-sidebar-view:<id>が担うため）
  "shift+b": "next-sidebar-view",
  // タイル・タブ・サイドバーの行へラベルを出して1打で飛ぶ。vimiumのfヒントを踏襲する
  // （tmuxにはdisplay-panesが近いが、キーも対象範囲も違うので合わせない）
  f: "jump-hint",
  // tmuxのprefix + [ に相当する入り口。[はワークスペース切替に使っているため、
  // viのvisualモードを連想できるvを既定にする
  v: "copy-mode",
  "`": "toggle-popup",
  // tmuxのbind-key i display-message（現在の状態を出す）に倣う。"info"の頭文字でもある
  i: "show-config",
  ":": "command-palette",
  "=": "increase-font-size",
  "-": "decrease-font-size",
  "0": "reset-font-size",
  pageup: "scroll-page-up",
  pagedown: "scroll-page-down",
  home: "scroll-to-top",
  end: "scroll-to-bottom",
  // OSC 133でマークされたプロンプトへ飛ぶ。素のup/down（フォーカス移動）と同じ方向感覚のまま
  // 「1コマンドぶん」動かせるようshiftを足した形にする。
  // 記号キー（{ }等）はキーボードレイアウトによってshiftの要否が変わるため既定には使わない
  "shift+up": "jump-prompt-up",
  "shift+down": "jump-prompt-down",
};

// 既定のprefixキー。tmux標準のCtrl+bをそのまま踏襲する（prefixキーは全操作の唯一の入り口であり、
// 個別ショートカットに課している「ctrl単独禁止」（Ctrl+C等ターミナル制御文字との衝突回避）は
// 性質上当てはまらないため、OS問わずCtrl+bで統一する）。
/** repeatTimeoutMs未指定・不正値の場合のフォールバック値(ms)。tmuxのrepeat-time既定と同じ500ms */
export const DEFAULT_REPEAT_TIMEOUT_MS = 500;

export const defaultKeybindings: KeybindingsConfig = {
  prefix: "ctrl+b",
  bindings: commonBindings,
  repeatTimeoutMs: DEFAULT_REPEAT_TIMEOUT_MS,
};

export const defaultWindowsKeybindings: KeybindingsConfig = {
  prefix: "ctrl+b",
  bindings: commonBindings,
  direct: {
    "ctrl+shift+c": "copy-selection",
    "ctrl+shift+v": "paste-clipboard",
  },
  repeatTimeoutMs: DEFAULT_REPEAT_TIMEOUT_MS,
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
 * cmd/ctrl/altのいずれも含まない（shift単独含む）・キー本体が空・未知の修飾子はnull
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
  if (!modifiers.has("cmd") && !modifiers.has("ctrl") && !modifiers.has("alt")) return null;
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
  if (typeof value !== "string") return false;
  if (parseShowSidebarViewAction(value) !== null) return true;
  if (parseSetBoardStatusAction(value) !== null) return true;
  return (KEYBIND_ACTIONS as readonly string[]).includes(value);
}

/**
 * 関数ハンドラ（niwa.keybindに関数を渡したエントリ）への参照。関数自体はRPCでシリアライズできないため、
 * bun側のハンドラレジストリが発行した一意idだけをwebview側へ送る（実行時はid経由でRPCを介してbun側に依頼する）。
 */
export interface CustomBindingRef {
  kind: "custom";
  id: string;
}

export function isCustomBindingRef(value: unknown): value is CustomBindingRef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v["kind"] === "custom" && typeof v["id"] === "string";
}

/** キーバインドの実行対象。既存アクション名の文字列、または関数ハンドラへの参照 */
export type BindingTarget = KeybindAction | CustomBindingRef;

export function isBindingTarget(value: unknown): value is BindingTarget {
  return isKeybindAction(value) || isCustomBindingRef(value);
}

/**
 * repeat（tmuxのbind-key -r相当）・descriptionといった付加情報を添えたバインドの表現。
 * プレーンなBindingTargetとのユニオンで bindings/direct の値に持たせる。repeatはboolean
 * （true固定にしない）で受け、{target, repeat:false}のような一見冗長な入力もプレーンな
 * BindingTargetと同様に扱えるようにする
 */
export interface DetailedBinding {
  target: BindingTarget;
  repeat?: boolean;
  /** キーバインド一覧（`niwaterm keybind list`）でアクション名の代わりに表示する説明 */
  description?: string;
}

export function isDetailedBinding(value: unknown): value is DetailedBinding {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isBindingTarget(v["target"])) return false;
  if (v["repeat"] !== undefined && typeof v["repeat"] !== "boolean") return false;
  if (v["description"] !== undefined && typeof v["description"] !== "string") return false;
  return true;
}

/** bindings/directの値として許容する形。プレーンなBindingTarget、または付加情報付きのラップ形 */
export type BindingEntry = BindingTarget | DetailedBinding;

/** compileKeybindings後のMap値。repeatは既定値まで埋めた形に正規化済み */
export interface CompiledBindingEntry {
  target: BindingTarget;
  repeat: boolean;
  /** 未指定はundefined（一覧表示側でアクション名へフォールバックする） */
  description?: string;
}

/** 生のBindingEntryをCompiledBindingEntryへ正規化する。不正な形はnull */
export function resolveBindingEntry(value: unknown): CompiledBindingEntry | null {
  if (isBindingTarget(value)) return { target: value, repeat: false };
  if (isDetailedBinding(value)) {
    return { target: value.target, repeat: value.repeat ?? false, description: value.description };
  }
  return null;
}

export interface CompiledKeybindings {
  /** 未設定・パース不可はnull（prefix機能自体が無効になる） */
  prefix: ParsedKeyBinding | null;
  /** canonicalizeSecondKeyで正規化したキーを持つ、prefix入力後の2打目キー→アクションのマップ */
  bindings: ReadonlyMap<string, CompiledBindingEntry>;
  /** canonicalizeParsedで正規化したキーを持つ、即時発火の直接ショートカットのマップ */
  direct: ReadonlyMap<string, CompiledBindingEntry>;
  /** repeat:trueなバインドが連打とみなす間隔(ms) */
  repeatTimeoutMs: number;
}

/** 不正なバインド文字列・未知のアクション名のエントリは黙ってスキップする */
export function compileKeybindings(config: KeybindingsConfig): CompiledKeybindings {
  const prefix = config.prefix !== undefined ? parseKeyBindingString(config.prefix) : null;

  const bindings = new Map<string, CompiledBindingEntry>();
  for (const [binding, entry] of Object.entries(config.bindings ?? {})) {
    if (entry === undefined) continue;
    const parsed = parseSecondKeyString(binding);
    const resolved = resolveBindingEntry(entry);
    if (!parsed || !resolved) continue;
    bindings.set(canonicalizeSecondKey(parsed), resolved);
  }

  const direct = new Map<string, CompiledBindingEntry>();
  for (const [binding, entry] of Object.entries(config.direct ?? {})) {
    if (entry === undefined) continue;
    const parsed = parseKeyBindingString(binding);
    const resolved = resolveBindingEntry(entry);
    if (!parsed || !resolved) continue;
    direct.set(canonicalizeParsed(parsed), resolved);
  }

  const repeatTimeoutMs =
    typeof config.repeatTimeoutMs === "number" && config.repeatTimeoutMs > 0
      ? config.repeatTimeoutMs
      : DEFAULT_REPEAT_TIMEOUT_MS;

  return { prefix, bindings, direct, repeatTimeoutMs };
}
