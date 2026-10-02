// サイドバー上端のツールバー（設定のsidebar.toolbar）の部品の評価と、押された部品の実行。
// 値の評価・runの呼び出しはステータスバーと同じ評価器（status-bar.ts）に任せ、ここでは
// webviewへ配る定義（アイコン・固定の文字・アクション）を組み立てるだけ。

import type {
  Niwa,
  ResolvedSidebarToolbarConfig,
  ResolvedSidebarToolbarItem,
  SidebarToolbarBuiltin,
  SidebarToolbarSection,
} from "@niwaterm/config";
import {
  type ComponentEntry,
  type ComponentEvaluator,
  createComponentEvaluator,
  type CreateStatusBarOptions,
} from "./status-bar";

/** 関数を含む解決済みの1部品 */
export interface SidebarToolbarEntry extends ComponentEntry {
  section: SidebarToolbarSection;
  /** ビルトインの部品ならそのid。sourceとrenderは持たない */
  builtin: SidebarToolbarBuiltin | null;
  /** 未指定は空文字列 */
  icon: string;
  /** 未指定は空文字列 */
  label: string;
  /** 未指定は空文字列 */
  html: string;
  /** runを持つ部品ではnull */
  action: ResolvedSidebarToolbarItem["action"];
}

export interface SidebarToolbarDefinition {
  visible: boolean;
  css: string;
  components: SidebarToolbarEntry[];
}

export interface SidebarToolbarHandle extends ComponentEvaluator {
  /** webviewへ配る定義（関数を除いたもの） */
  resolved(): ResolvedSidebarToolbarConfig;
}

export function createSidebarToolbar(
  definition: SidebarToolbarDefinition,
  niwa: Niwa,
  opts: Omit<CreateStatusBarOptions, "hidden">,
): SidebarToolbarHandle {
  const resolvedConfig: ResolvedSidebarToolbarConfig = {
    visible: definition.visible,
    css: definition.css,
    sections: { left: [], right: [] },
  };
  for (const entry of definition.components) {
    resolvedConfig.sections[entry.section].push({
      id: entry.id,
      builtin: entry.builtin,
      icon: entry.icon,
      label: entry.label,
      html: entry.html,
      tooltip: entry.tooltip,
      color: entry.color,
      dynamic: entry.render !== undefined || entry.source !== null,
      runnable: entry.run !== undefined,
      action: entry.action,
    });
  }
  const evaluator = createComponentEvaluator(definition.components, niwa, {
    ...opts,
    label: "sidebar.toolbar",
    enabled: definition.visible,
    // サイドバーごと隠している間も値を評価しておく。サイドバーの開閉はウィンドウごとにwebview側が
    // 持っていてbun側からは見えないため
    hidden: false,
  });
  return {
    ...evaluator,
    resolved() {
      return resolvedConfig;
    },
  };
}
