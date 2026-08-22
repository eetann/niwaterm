import type { ElectrobunConfig } from "electrobun";
import tailwind from "bun-plugin-tailwind";
import { createMainviewAliasPlugin } from "./bun-mainview-alias-plugin";

const mainviewRoot = `${import.meta.dir}/src/mainview`;

export default {
	app: {
		// 普段遣い用ビルドは`NIWATERM_APP_NAME=niwaterm-daily`を指定して起動する
		// （mise.tomlの`start:daily`/`win:start:daily`参照）。devチャンネルのまま
		// アプリ名だけ変えることで、開発中ビルド(niwaterm-dev)と普段遣いビルド
		// (niwaterm-daily-dev)を同時に安全に動かせるようにしている。
		// stable/canaryチャンネルは配布用インストーラ作成が目的でビルド後すぐ直接実行できる
		// appバンドルを作らないため採用していない
		// （詳細: docs/known-issues/windows-stable-build-not-directly-runnable.md）
		name: process.env.NIWATERM_APP_NAME || "niwaterm",
		identifier: "dev.eetann.niwaterm",
		version: "0.0.1",
	},
	build: {
		// ElectrobunはbuildFolder配下を"{channel}-{os}-{arch}"単位でビルドの度に
		// rmSync(recursive)で丸ごと削除・作り直す（アプリ名は含まれない）。そのため
		// 開発中ビルド(niwaterm-dev)と普段遣いビルド(niwaterm-daily-dev)を同じ"build/"の
		// まま同時にビルドすると、片方のビルド中にもう片方の成果物ごと削除されてしまい、
		// 起動中のプロセスがファイルをロックしているとEACCESでビルド自体が失敗する
		// （実機で確認済み）。アプリ名ごとにbuildFolder自体を分けることで回避する
		buildFolder: process.env.NIWATERM_APP_NAME ? `build/${process.env.NIWATERM_APP_NAME}` : "build",
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
			icons: "assets/icon/icon.iconset",
		},
		linux: {
			bundleCEF: false,
			icon: "assets/icon/icon.png",
		},
		win: {
			bundleCEF: false,
			icon: "assets/icon/icon.ico",
		},
	},
	scripts: {
		// 実際に使われたアプリ名(niwaterm-dev / niwaterm-daily-dev等)を
		// src/bun/app-variant.generated.tsへ焼き込む。詳細はscripts/write-app-variant.ts参照
		preBuild: "scripts/write-app-variant.ts",
		// electrobun 1.18.1のrcedit解決バグ（https://github.com/blackboardsh/electrobun/issues/429）の
		// 回避策。詳細はscripts/embed-windows-icon.ts参照
		postBuild: "scripts/embed-windows-icon.ts",
	},
} satisfies ElectrobunConfig;
