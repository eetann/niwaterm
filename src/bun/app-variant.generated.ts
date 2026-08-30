// scripts/write-app-variant.tsがビルド前フック(preBuild)で上書きする。
// bun testやpreBuildが走っていない状態でも壊れないよう、devのデフォルト値をコミットしておく。
export const APP_VARIANT: string = "niwaterm-wip";
