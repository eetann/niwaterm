import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import {
  listKeybindings,
  resolveIpcEndpoint,
  type KeybindEntry,
  type ListKeybindingsResult,
} from "../../ipc-client";

/** 実際に押すキー表記。prefix側はprefixキーを前置した2打分の表記にする */
function keyLabel(entry: KeybindEntry, prefix: string | null): string {
  if (entry.noPrefix || entry.mode !== undefined) return entry.key;
  return prefix === null ? entry.key : `${prefix} ${entry.key}`;
}

/** 説明があればそれを、無ければアクション名（関数ハンドラは"function"）を表示する */
function actionLabel(entry: KeybindEntry): string {
  const label = entry.description ?? entry.action;
  return entry.repeat ? `${label} (repeat)` : label;
}

function entryLines(entries: KeybindEntry[], prefix: string | null, keyWidth: number): string[] {
  return entries.map(
    (entry) => `${keyLabel(entry, prefix).padEnd(keyWidth)}  ${actionLabel(entry)}`,
  );
}

export function formatKeybindList(result: Extract<ListKeybindingsResult, { ok: true }>): string[] {
  const { prefix, entries } = result;
  const lines = [
    prefix === null
      ? "prefix: (未設定。prefixを介するバインドは発火しません)"
      : `prefix: ${prefix} (repeat-timeout: ${result.repeatTimeoutMs}ms)`,
  ];
  if (entries.length === 0) {
    lines.push("(キーバインドが設定されていません)");
    return lines;
  }
  // 表ごとに同じキー表記でも意味が違うため、混ぜずにグループを分けて表示する
  const keyWidth = Math.max(...entries.map((e) => keyLabel(e, prefix).length));
  for (const [heading, group] of [
    ["[prefix]", entries.filter((e) => !e.noPrefix && e.mode === undefined)],
    ["[direct]", entries.filter((e) => e.noPrefix && e.mode === undefined)],
    ["[copy-mode]", entries.filter((e) => e.mode === "copy")],
    ["[copy-mode search]", entries.filter((e) => e.mode === "copy-search")],
  ] as const) {
    if (group.length === 0) continue;
    lines.push("", heading, ...entryLines(group, prefix, keyWidth));
  }
  return lines;
}

export default define({
  name: "list",
  description: "現在有効なキーバインドの一覧を表示",
  run: async () => {
    const result = await listKeybindings(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`keybind listに失敗しました: ${result.error}`);
    }
    for (const line of formatKeybindList(result)) {
      console.log(line);
    }
  },
});
