// 選択範囲の右クリックメニュー（mouse.selectionMenu）の組み立てと実行。
// ユーザー設定の関数はbun側でしか呼べないため、webviewへはラベルとidだけを渡し、
// 選ばれたidからここでrunを引いて実行する（キーバインドの関数ハンドラと同じ方式）。

import type {
  Niwa,
  SelectionMenuContext,
  SelectionMenuFn,
  SelectionMenuItem,
} from "@niwaterm/config";

/** webviewへ渡すメニュー項目。runの実体はbun側に残す */
export interface SelectionMenuEntry {
  id: string;
  label: string;
}

export interface SelectionMenuHandle {
  /** 右クリックのたびに呼ぶ。ユーザー設定が無ければ空配列 */
  build(selection: SelectionMenuContext): Promise<SelectionMenuEntry[]>;
  /** webviewで選ばれた項目を実行する。idが古い・存在しない場合は何もしない */
  run(id: string): Promise<void>;
}

function isValidItem(value: unknown): value is SelectionMenuItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item["label"] === "string" && typeof item["run"] === "function";
}

export function createSelectionMenu(fn: SelectionMenuFn | null, niwa: Niwa): SelectionMenuHandle {
  // 表示中のメニュー1枚分のrunだけを保持する。webviewは今出ているメニューの項目しか選べず、
  // 次の右クリックで前のメニューは閉じているため、世代が変わった時点で捨てて構わない
  let currentRuns = new Map<string, SelectionMenuItem["run"]>();
  let generation = 0;

  return {
    async build(selection) {
      currentRuns = new Map();
      generation++;
      if (!fn) return [];
      let items: unknown;
      try {
        items = await fn(selection, niwa);
      } catch (err) {
        console.log(`[bun] mouse.selectionMenu failed: ${String(err)}`);
        return [];
      }
      if (!Array.isArray(items)) {
        console.log(`[bun] ignoring mouse.selectionMenu result: not an array`);
        return [];
      }
      const entries: SelectionMenuEntry[] = [];
      for (const item of items) {
        if (!isValidItem(item)) {
          console.log(`[bun] ignoring invalid mouse.selectionMenu item: ${String(item)}`);
          continue;
        }
        const id = `${generation}-${entries.length}`;
        currentRuns.set(id, item.run);
        entries.push({ id, label: item.label });
      }
      return entries;
    },
    async run(id) {
      const handler = currentRuns.get(id);
      if (!handler) return;
      try {
        await handler();
      } catch (err) {
        console.log(`[bun] mouse.selectionMenu item failed: ${String(err)}`);
      }
    },
  };
}
