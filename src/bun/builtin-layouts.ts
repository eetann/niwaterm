// 設定ファイルに定義が無くても使えるビルトインのレイアウトプリセット。
//
// 名前解決はプロジェクトローカル → グローバル設定 → ビルトインの順で、ここの名前は同名の
// ユーザー定義プリセットに隠される（ビルトインが後から増えてもユーザーの定義を奪わないため）。
//
// 適用の実体はlayout-apply.tsのapplyBuiltinLayout。名前の一覧は設定側（project-config.ts）からも
// 引くため、このファイルは他のモジュールへ依存させない（project-config.ts ↔ layout-apply.tsの
// 循環importを避ける）。

export const BUILTIN_LAYOUT_NAMES = ["empty"] as const;

export type BuiltinLayoutName = (typeof BUILTIN_LAYOUT_NAMES)[number];

/** `niwa layout list`に出す説明文 */
export const BUILTIN_LAYOUT_DESCRIPTIONS: Record<BuiltinLayoutName, string> = {
  empty: "Boardをタイル1つ・タブ1つへ畳み、残るタブのシェルも起動し直す（ビルトイン）",
};

export function isBuiltinLayoutName(name: string): name is BuiltinLayoutName {
  return (BUILTIN_LAYOUT_NAMES as readonly string[]).includes(name);
}
