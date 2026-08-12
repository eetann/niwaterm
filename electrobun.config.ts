import type { ElectrobunConfig } from "electrobun";
import tailwind from "bun-plugin-tailwind";
import { createMainviewAliasPlugin } from "./bun-mainview-alias-plugin";

const mainviewRoot = `${import.meta.dir}/src/mainview`;

export default {
	app: {
		name: "niwaterm",
		identifier: "dev.eetann.niwaterm",
		version: "0.0.1",
	},
	build: {
		// Electrobun 1.18.1が同梱するBunは1.3.13で、Bun.TerminalのWindows対応(ConPTY)が入った
		// 1.3.14に届かない。そのままだとWindowsでPTY生成時に
		// "PTY not supported on this platform" で落ちるため、明示的に上書きする
		bunVersion: "1.3.14",
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
				// ElectrobunのCLIはコンパイル済みバイナリとして動くため、内部のBun.build()は
				// tsconfig.jsonの"paths"エイリアス(@/*)を解決できない（実機検証で確認済み）。
				// 自前のonResolveプラグインでエイリアス解決を肩代わりする
				plugins: [createMainviewAliasPlugin(mainviewRoot), tailwind],
				jsx: { runtime: "automatic" },
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
		},
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
