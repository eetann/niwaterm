// コピーモード中のキーバインド。tmuxの`bind-key -T copy-mode-vi`と同じく、prefixの表とは別の表を持つ。
// コピーモード中のキーはシェルへ送らないため、prefix・2打目キーの表と違って修飾なしのキーも
// ctrl/cmdを付けたキーも割り当てられる。空白で区切ると連続して押すキーになる（"g g"）。
//
// 表は2つある。カーソル移動・選択などの通常の表（copyMode）と、`/` `?`で検索文字列を
// 入力している間の表（copyModeSearch）。検索入力中は表に無い1文字キーを検索文字列へ足す。

import { canonicalizeParsed, type CustomBindingRef, isCustomBindingRef } from "./keybindings";

export const COPY_MODE_ACTIONS = [
  "copy-cursor-left",
  "copy-cursor-right",
  "copy-cursor-up",
  "copy-cursor-down",
  "copy-word-forward",
  "copy-word-backward",
  "copy-word-end",
  "copy-line-start",
  "copy-first-non-blank",
  "copy-line-end",
  "copy-top",
  "copy-bottom",
  "copy-screen-top",
  "copy-screen-middle",
  "copy-screen-bottom",
  "copy-half-page-up",
  "copy-half-page-down",
  "copy-page-up",
  "copy-page-down",
  "copy-search-forward",
  "copy-search-backward",
  "copy-search-next",
  "copy-search-prev",
  "copy-prompt-up",
  "copy-prompt-down",
  "copy-select-char",
  "copy-select-line",
  "copy-yank",
  "copy-cancel",
  "copy-exit",
] as const;

export type CopyModeAction = (typeof COPY_MODE_ACTIONS)[number];

export const COPY_MODE_SEARCH_ACTIONS = [
  "copy-search-confirm",
  "copy-search-cancel",
  "copy-search-delete-char",
  "copy-search-clear",
] as const;

export type CopyModeSearchAction = (typeof COPY_MODE_SEARCH_ACTIONS)[number];

/** niwa.keybindのmodeオプションで選ぶキーの表 */
export type CopyModeKeymapMode = "copy" | "copy-search";

export function isCopyModeAction(value: unknown): value is CopyModeAction {
  return typeof value === "string" && (COPY_MODE_ACTIONS as readonly string[]).includes(value);
}

export function isCopyModeSearchAction(value: unknown): value is CopyModeSearchAction {
  return (
    typeof value === "string" && (COPY_MODE_SEARCH_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * コピーモードの表に書くエントリ。アクション名・関数ハンドラへの参照、または説明を添えたラップ形。
 * 連打（repeat）はprefixを省くための仕組みで、prefixの無いコピーモードには要らないため持たない
 */
export type CopyModeBindingEntry<A extends string> =
  | A
  | CustomBindingRef
  | { target: A | CustomBindingRef; description?: string };

export interface CompiledCopyModeBinding<A extends string> {
  target: A | CustomBindingRef;
  description?: string;
}

/** 生のエントリを正規化する。表に無いアクション名・不正な形はnull */
export function resolveCopyModeBindingEntry<A extends string>(
  value: unknown,
  isAction: (v: unknown) => v is A,
): CompiledCopyModeBinding<A> | null {
  if (isAction(value) || isCustomBindingRef(value)) return { target: value };
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const target = v["target"];
  if (!isAction(target) && !isCustomBindingRef(target)) return null;
  if (v["description"] !== undefined && typeof v["description"] !== "string") return null;
  return { target, description: v["description"] as string | undefined };
}

const COPY_MODE_MODIFIERS: ReadonlySet<string> = new Set(["cmd", "ctrl", "shift", "alt"]);

/**
 * コピーモードのキー表記（空白区切りの連続キー）を、canonicalizeParsedの形に正規化した列へ変換する。
 * 1打ごとの修飾子はcmd/ctrl/shift/altのどれでもよく、無くてもよい。解釈できない表記はnull
 */
export function parseCopyModeKeySequence(binding: string): string[] | null {
  const strokes = binding.trim().split(/\s+/u);
  if (strokes.length === 0 || strokes[0] === "") return null;
  const canonicals: string[] = [];
  for (const stroke of strokes) {
    const tokens = stroke.split("+").map((t) => t.trim().toLowerCase());
    const key = tokens.at(-1);
    if (!key) return null;
    const modifiers = new Set(tokens.slice(0, -1));
    for (const m of modifiers) {
      if (!COPY_MODE_MODIFIERS.has(m)) return null;
    }
    canonicals.push(
      canonicalizeParsed({
        cmd: modifiers.has("cmd"),
        ctrl: modifiers.has("ctrl"),
        shift: modifiers.has("shift"),
        alt: modifiers.has("alt"),
        key,
      }),
    );
  }
  return canonicals;
}

export interface CompiledCopyModeTable<A extends string> {
  /** 1打ごとのcanonicalを空白で繋いだ列 → エントリ */
  bindings: ReadonlyMap<string, CompiledCopyModeBinding<A>>;
  /** 連続キーの途中までの列（"g g"なら"g"）。これに当たったら次のキーを待つ */
  pendingPrefixes: ReadonlySet<string>;
}

export interface CompiledCopyModeKeymap {
  normal: CompiledCopyModeTable<CopyModeAction>;
  /** 検索入力中の表。連続キーは扱わない（1文字ずつ検索文字列へ足す入力と両立しないため） */
  search: CompiledCopyModeTable<CopyModeSearchAction>;
}

function compileTable<A extends string>(
  entries: Partial<Record<string, CopyModeBindingEntry<A>>> | undefined,
  isAction: (v: unknown) => v is A,
  allowSequence: boolean,
): CompiledCopyModeTable<A> {
  const bindings = new Map<string, CompiledCopyModeBinding<A>>();
  const pendingPrefixes = new Set<string>();
  for (const [key, entry] of Object.entries(entries ?? {})) {
    if (entry === undefined) continue;
    const sequence = parseCopyModeKeySequence(key);
    const resolved = resolveCopyModeBindingEntry(entry, isAction);
    if (!sequence || !resolved) continue;
    if (!allowSequence && sequence.length > 1) continue;
    bindings.set(sequence.join(" "), resolved);
    for (let i = 1; i < sequence.length; i++) {
      pendingPrefixes.add(sequence.slice(0, i).join(" "));
    }
  }
  return { bindings, pendingPrefixes };
}

/** 不正なキー表記・表に無いアクション名のエントリは黙ってスキップする */
export function compileCopyModeKeymap(config: {
  copyMode?: Partial<Record<string, CopyModeBindingEntry<CopyModeAction>>>;
  copyModeSearch?: Partial<Record<string, CopyModeBindingEntry<CopyModeSearchAction>>>;
}): CompiledCopyModeKeymap {
  return {
    normal: compileTable(config.copyMode, isCopyModeAction, true),
    search: compileTable(config.copyModeSearch, isCopyModeSearchAction, false),
  };
}

/** キー表記がその表で使える形か（検索入力中の表は連続キーを受け付けない） */
export function isValidCopyModeKey(binding: string, mode: CopyModeKeymapMode): boolean {
  const sequence = parseCopyModeKeySequence(binding);
  if (!sequence) return false;
  return mode === "copy" || sequence.length === 1;
}
