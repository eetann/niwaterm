import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BunPlugin } from "bun";

const EXTENSION_CANDIDATES = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];

// ElectrobunのCLIはコンパイル済みバイナリとして動作しており、その内部から呼ばれる
// Bun.build()はtsconfig.jsonの"paths"エイリアス(@/*)を解決できない（実機検証で確認済み）。
// そのためエイリアス解決をこのプラグインで肩代わりする。
export function createMainviewAliasPlugin(mainviewRoot: string): BunPlugin {
  return {
    name: "mainview-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const withoutExt = join(mainviewRoot, args.path.slice(2));
        for (const ext of EXTENSION_CANDIDATES) {
          const candidate = `${withoutExt}${ext}`;
          if (existsSync(candidate)) {
            return { path: candidate };
          }
        }
        return { path: withoutExt };
      });
    },
  };
}
