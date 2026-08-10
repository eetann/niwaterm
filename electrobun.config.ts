import type { ElectrobunConfig } from "electrobun";

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
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
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
