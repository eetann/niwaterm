// preBuildフックで実行され、実際に使われたアプリ名(ELECTROBUN_APP_NAME、
// 例: "niwaterm-wip-dev" / "niwaterm-daily-dev")をアプリの実行時コードから参照できるよう
// src/bun/app-variant.generated.tsへ焼き込む。
// appSupportDir()（設定・永続化・IPCソケットの置き場所）はこの値でビルド間を分岐する。
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const appVariant = process.env.ELECTROBUN_APP_NAME || "niwaterm-wip-dev";
const outPath = join(import.meta.dir, "..", "src", "bun", "app-variant.generated.ts");

writeFileSync(
	outPath,
	`// scripts/write-app-variant.tsがビルド前フック(preBuild)で上書きする。
// bun testやpreBuildが走っていない状態でも壊れないよう、devのデフォルト値をコミットしておく。
export const APP_VARIANT: string = ${JSON.stringify(appVariant)};
`,
);

console.log(`preBuild(write-app-variant): APP_VARIANT = ${appVariant}`);
