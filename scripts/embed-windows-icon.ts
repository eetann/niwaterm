// electrobun 1.18.1のCLIは`bun build --compile`で単一exeに配布されており、
// アイコン埋め込みステップの`require.resolve("rcedit/package.json")`がビルド時に
// メンテナ側CIランナーの絶対パス(D:\a\electrobun\electrobun\package\node_modules\rcedit)を
// 焼き込んでしまっているため、利用者の環境では常に解決失敗して警告付きでスキップされる
// （上流の既知バグ、stableでは未修正: https://github.com/blackboardsh/electrobun/issues/429）。
// electrobun本体のビルドが終わったあと(postBuildフック)、niwaterm自身が解決できるrceditで
// launcher.exe / bun.exeへアイコンを埋め込み直す。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

if (process.env.ELECTROBUN_OS === "win") {
	const buildDir = process.env.ELECTROBUN_BUILD_DIR;
	const appName = process.env.ELECTROBUN_APP_NAME;
	if (!buildDir || !appName) {
		throw new Error(
			"postBuild(embed-windows-icon): ELECTROBUN_BUILD_DIR / ELECTROBUN_APP_NAME が未設定です",
		);
	}

	// electrobun.config.tsのbuild.win.iconと同じパスを指す
	const iconPath = join(process.cwd(), "assets", "icon", "icon.ico");
	const binDir = join(buildDir, appName, "bin");
	const rceditDir = dirname(require.resolve("rcedit/package.json"));
	const rceditExe = join(rceditDir, "bin", "rcedit-x64.exe");

	if (!existsSync(rceditExe)) {
		throw new Error(`postBuild(embed-windows-icon): rceditが見つかりません: ${rceditExe}`);
	}
	if (!existsSync(iconPath)) {
		throw new Error(`postBuild(embed-windows-icon): アイコンが見つかりません: ${iconPath}`);
	}

	for (const exeName of ["launcher.exe", "bun.exe"]) {
		const exePath = join(binDir, exeName);
		if (!existsSync(exePath)) {
			console.warn(`postBuild(embed-windows-icon): ${exePath} が無いためスキップ`);
			continue;
		}
		execFileSync(rceditExe, [exePath, "--set-icon", iconPath]);
		console.log(`postBuild(embed-windows-icon): ${exeName} にアイコンを埋め込みました`);
	}
}
