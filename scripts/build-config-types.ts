// preBuildフックで実行され、ユーザー設定ファイル（niwaterm.config.ts）をエディタで書くための型定義を
// .config-types-build/に生成する。アプリは起動時にこれを設定ディレクトリの.niwaterm-types/へ同期し
// （src/bun/config-module.ts）、設定ファイルは`/// <reference path>`でそれを読む。
//
// 生成物:
//   niwaterm.d.ts  … @niwaterm/configの型を`declare module`で包んだもの＋Bunの型への参照
//   node_modules/  … bun-types・@types/node・undici-typesの宣言ファイル。`/// <reference types>`は
//                    参照元ファイルから上向きにnode_modulesを探すため、niwaterm.d.tsの隣に置く
//   stamp          … 中身のハッシュ。アプリはこれを比べて同期が要るかを決める
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const projectRoot = join(import.meta.dir, "..");
const outDir = join(projectRoot, ".config-types-build");
const configPackageDir = join(projectRoot, "packages", "config");

/** 包んだ各ファイルのモジュール名の接頭辞。ユーザーが直接importする名前ではない */
const INTERNAL_PREFIX = "@niwaterm/config/_internal/";

function emitDeclarations(): string {
	const dtsDir = mkdtempSync(join(tmpdir(), "niwaterm-config-dts-"));
	// dts-bundle-generator等の束ねるツールはbun-typesを含むプログラム全体を解析して数十秒かかるため、
	// tscで宣言ファイルだけを出してから自前で包む
	execFileSync(
		process.execPath,
		[
			join(projectRoot, "node_modules", "typescript", "bin", "tsc"),
			"-p",
			join(configPackageDir, "tsconfig.json"),
			"--noEmit",
			"false",
			"--declaration",
			"--emitDeclarationOnly",
			"--outDir",
			dtsDir,
		],
		{ stdio: "inherit", windowsHide: true },
	);
	return dtsDir;
}

/**
 * 1ファイル分の宣言を`declare module`で包む。ambientなモジュール宣言の中では相対importと
 * `declare`修飾子が使えないため、相対importは内部用のモジュール名へ、トップレベルの`declare`は外す
 */
function wrapModule(moduleName: string, source: string): string {
	const body = source
		.replaceAll(/(from |import\()"\.\/([^"]+)"/g, (_m, head: string, name: string) => `${head}"${INTERNAL_PREFIX}${name}"`)
		.replaceAll(/^(export )?declare /gm, "$1");
	const indented = body
		.trimEnd()
		.split("\n")
		.map((line) => (line ? `\t${line}` : line))
		.join("\n");
	return `declare module "${moduleName}" {\n${indented}\n}\n`;
}

function buildNiwatermDts(dtsDir: string): string {
	const files = readdirSync(dtsDir)
		.filter((f) => f.endsWith(".d.ts") && !f.endsWith(".test.d.ts"))
		.sort();
	const modules = files.map((file) => {
		const name = file.slice(0, -".d.ts".length);
		const moduleName = name === "index" ? "@niwaterm/config" : `${INTERNAL_PREFIX}${name}`;
		return wrapModule(moduleName, readFileSync(join(dtsDir, file), "utf8"));
	});
	return [
		"// niwatermが生成するファイル。編集しても起動時に上書きされる",
		'/// <reference types="bun-types" />',
		"",
		...modules,
	].join("\n");
}

/** パッケージのpackage.jsonと宣言ファイルだけを、ディレクトリ構成を保ってコピーする */
function copyTypesPackage(srcDir: string, destDir: string): void {
	cpSync(srcDir, destDir, {
		recursive: true,
		dereference: true,
		filter: (src) => {
			if (statSync(src).isDirectory()) return !src.endsWith("node_modules");
			return src.endsWith(".d.ts") || relative(srcDir, src) === "package.json";
		},
	});
}

/** bun-typesが参照する@types/node、@types/nodeが参照するundici-typesを順に辿って解決する */
function resolvePackageDir(name: string, fromDir: string): string {
	return dirname(realpathSync(Bun.resolveSync(`${name}/package.json`, fromDir)));
}

function hashDir(dir: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	const walk = (d: string): void => {
		for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const p = join(d, entry.name);
			if (entry.isDirectory()) {
				walk(p);
			} else {
				hasher.update(relative(dir, p).replaceAll("\\", "/"));
				hasher.update(readFileSync(p));
			}
		}
	};
	walk(dir);
	return hasher.digest("hex");
}

const dtsDir = emitDeclarations();
const niwatermDts = buildNiwatermDts(dtsDir);
rmSync(dtsDir, { recursive: true, force: true });

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "niwaterm.d.ts"), niwatermDts);
// 設定ディレクトリに`{ "extends": "./.niwaterm-types/tsconfig.json" }`を置いた場合に使う。
// tsconfig.jsonが無いとエディタは緩い既定値で動き、strictにならず`./foo.ts`の拡張子付きimportもエラーになる。
// files・include・excludeは継承元（このファイル）からの相対パスで解決される
writeFileSync(
	join(outDir, "tsconfig.json"),
	`${JSON.stringify(
		{
			compilerOptions: {
				target: "ESNext",
				module: "ESNext",
				moduleResolution: "bundler",
				moduleDetection: "force",
				allowImportingTsExtensions: true,
				strict: true,
				skipLibCheck: true,
				noEmit: true,
				types: [],
			},
			files: ["./niwaterm.d.ts"],
			include: ["../**/*.ts"],
			exclude: ["../node_modules", "./node_modules"],
		},
		null,
		2,
	)}\n`,
);

const bunTypesDir = resolvePackageDir("bun-types", resolvePackageDir("@types/bun", projectRoot));
const nodeTypesDir = resolvePackageDir("@types/node", bunTypesDir);
const undiciTypesDir = resolvePackageDir("undici-types", nodeTypesDir);
copyTypesPackage(bunTypesDir, join(outDir, "node_modules", "bun-types"));
copyTypesPackage(nodeTypesDir, join(outDir, "node_modules", "@types", "node"));
copyTypesPackage(undiciTypesDir, join(outDir, "node_modules", "undici-types"));

writeFileSync(join(outDir, "stamp"), hashDir(outDir));

console.log("preBuild(build-config-types): config types generated");
