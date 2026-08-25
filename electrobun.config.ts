import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		// 開発中ビルド(niwaterm-wip)がデフォルト。普段遣い用ビルドは`NIWATERM_APP_NAME=niwaterm-daily`
		// を指定して起動する（mise.tomlの`start:daily`/`win:start:daily`参照）。devチャンネルのまま
		// アプリ名だけ変えることで、開発中ビルド(niwaterm-wip-dev)と普段遣いビルド
		// (niwaterm-daily-dev)を同時に安全に動かせるようにしている。両方とも"wip"/"daily"という
		// 一目で区別できる単語にすることで、AIエージェントが指示を取り違えて普段遣いの方を
		// 操作してしまう事故を防ぐ（過去に"niwaterm"(無印)/"niwaterm-daily"というdevチャンネル
		// サフィックス頼みの命名で頻発したため改名した）。
		// stable/canaryチャンネルは配布用インストーラ作成が目的でビルド後すぐ直接実行できる
		// appバンドルを作らないため採用していない
		// （詳細: docs/known-issues/windows-stable-build-not-directly-runnable.md）
		name: process.env.NIWATERM_APP_NAME || "niwaterm-wip",
		identifier: "dev.eetann.niwaterm",
		version: "0.0.1",
	},
	build: {
		// ElectrobunはbuildFolder配下を"{channel}-{os}-{arch}"単位でビルドの度に
		// rmSync(recursive)で丸ごと削除・作り直す（アプリ名は含まれない）。そのため
		// 開発中ビルド(niwaterm-wip-dev)と普段遣いビルド(niwaterm-daily-dev)を同じ"build/"の
		// まま同時にビルドすると、片方のビルド中にもう片方の成果物ごと削除されてしまい、
		// 起動中のプロセスがファイルをロックしているとEACCESでビルド自体が失敗する
		// （実機で確認済み）。アプリ名ごとにbuildFolder自体を分けることで回避する
		buildFolder: process.env.NIWATERM_APP_NAME ? `build/${process.env.NIWATERM_APP_NAME}` : "build",
		// Bun.Terminal（PTY）に依存しているため、メインプロセスはcottontailではなくbunのまま使う
		mainProcess: "bun",
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
				alias: { "@/*": "./src/mainview/*" },
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			// scripts/build-tailwind.ts(preBuild)が生成する。electrobun 2.xでviews.<name>.pluginsが
			// 廃止され、bun-plugin-tailwindによるビルド時変換ができなくなったための代替
			".tailwind-build/index.css": "views/mainview/index.css",
		},
		// src/mainview/index.cssはentrypoint・copyのどちらにも列挙されないため、
		// devの--watchで変更を検知させるために明示する
		watch: ["src/mainview/index.css"],
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
		// preBuildは1スクリプトしか指定できないため、複数の前処理をscripts/pre-build.ts経由でまとめる。
		// 中身は実際に使われたアプリ名の焼き込み(scripts/write-app-variant.ts)とTailwind CSSの
		// ビルド(scripts/build-tailwind.ts)
		preBuild: "scripts/pre-build.ts",
	},
} satisfies ElectrobunConfig;
