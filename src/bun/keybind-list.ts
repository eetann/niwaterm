// キーバインド一覧（IPCの/keybindings → CLIの`niwa keybind list`）用の正規化。
// KeybindingsConfigはprefix入力後のbindings・即時発火のdirectに分かれ、値もプレーンなアクション名と
// オブジェクト形（repeat・description付き）が混在するため、表示側が扱いやすい1本の配列へ均す。
//
// 実際に発火しないエントリ（キー表記が不正なもの）はcompileKeybindingsと同じ基準で落とす。
// 一覧の用途は「今どう割り当たっているか」の確認であり、発火しないものを混ぜると確認にならないため。

import {
  isCustomBindingRef,
  parseKeyBindingString,
  parseSecondKeyString,
  resolveBindingEntry,
  DEFAULT_REPEAT_TIMEOUT_MS,
  type KeybindingsConfig,
} from "@niwaterm/config";

/** 関数ハンドラ（niwa.keybindに関数を渡したバインド）のaction表示。descriptionが無い場合のフォールバック */
export const CUSTOM_HANDLER_ACTION = "function";

export interface KeybindEntryInfo {
  /** noPrefix:falseならprefix入力後の2打目キー、trueならキー表記そのもの */
  key: string;
  /** アクション名。関数ハンドラは"function" */
  action: string;
  /** niwa.keybindのopts.descriptionで付けた説明。未指定はundefined */
  description?: string;
  repeat: boolean;
  /** trueならprefix不要で即時発火する */
  noPrefix: boolean;
}

export interface KeybindListInfo {
  /** prefixキー。未設定・不正な表記はnull（この場合noPrefix:falseのバインドは発火しない） */
  prefix: string | null;
  repeatTimeoutMs: number;
  /** prefix側→direct側の順、各グループ内はキー表記順 */
  entries: KeybindEntryInfo[];
}

function toEntry(key: string, rawEntry: unknown, noPrefix: boolean): KeybindEntryInfo | null {
  const resolved = resolveBindingEntry(rawEntry);
  if (!resolved) return null;
  const parsed = noPrefix ? parseKeyBindingString(key) : parseSecondKeyString(key);
  if (!parsed) return null;
  return {
    key,
    action: isCustomBindingRef(resolved.target) ? CUSTOM_HANDLER_ACTION : resolved.target,
    description: resolved.description,
    repeat: resolved.repeat,
    noPrefix,
  };
}

function collect(
  source: Partial<Record<string, unknown>> | undefined,
  noPrefix: boolean,
): KeybindEntryInfo[] {
  const entries: KeybindEntryInfo[] = [];
  for (const [key, rawEntry] of Object.entries(source ?? {})) {
    if (rawEntry === undefined) continue;
    const entry = toEntry(key, rawEntry, noPrefix);
    if (entry) entries.push(entry);
  }
  // 登録順は「デフォルト→ユーザー設定」の重ね順で、しかも数字キー("0")がオブジェクトの
  // 先頭へ回るため一覧としては読みにくい。キー表記順に並べ直す
  return entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function buildKeybindList(config: KeybindingsConfig): KeybindListInfo {
  const prefix =
    config.prefix !== undefined && parseKeyBindingString(config.prefix) ? config.prefix : null;
  const repeatTimeoutMs =
    typeof config.repeatTimeoutMs === "number" && config.repeatTimeoutMs > 0
      ? config.repeatTimeoutMs
      : DEFAULT_REPEAT_TIMEOUT_MS;
  return {
    prefix,
    repeatTimeoutMs,
    entries: [...collect(config.bindings, false), ...collect(config.direct, true)],
  };
}
