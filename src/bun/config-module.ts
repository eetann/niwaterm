// ユーザー設定ファイルがimportする`@niwaterm/config`を、ユーザー側のnode_modulesではなく
// アプリ自身が持つモジュールへ解決させる。設定ディレクトリでのpackage.json・bun installを不要にし、
// 設定が受け取るAPIを常に動いているアプリと同じ版に揃えるため。
// エディタ向けの型は、同じ版のものをscripts/build-config-types.tsがビルド時に生成し、
// 起動時に設定ディレクトリのCONFIG_TYPES_DIR_NAME配下へ同期する。

import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as configApi from "@niwaterm/config";
import { findNativeArtifact } from "./native-artifacts";

/** 設定ディレクトリ内でアプリが型定義を書き出すディレクトリ名 */
export const CONFIG_TYPES_DIR_NAME = ".niwaterm-types";

/** scripts/build-config-types.tsの出力先（repoルート相対） */
const CONFIG_TYPES_BUILD_DIR = ".config-types-build";

/** 生成物の中身のハッシュを書いたファイル。同期が要るかをこれの一致で決める */
const STAMP_FILE_NAME = "stamp";

let registered = false;

/**
 * `@niwaterm/config`を仮想モジュールとして登録する。Bunのランタイムプラグインは登録後の
 * import全体に効き、node_modulesに同名パッケージがあっても仮想モジュールが優先される。
 * 設定ファイルをimportする前に呼ぶ（2回目以降は何もしない）
 */
export function registerConfigModule(): void {
  if (registered) return;
  registered = true;
  Bun.plugin({
    name: "niwaterm-config-module",
    setup(build) {
      build.module("@niwaterm/config", () => ({ exports: { ...configApi }, loader: "object" }));
    },
  });
}

/** ビルド時に生成した型定義のディレクトリ。生成前（preBuild未実行）ならundefined */
export function findConfigTypesBuildDir(): string | undefined {
  const stamp = findNativeArtifact(join(CONFIG_TYPES_BUILD_DIR, STAMP_FILE_NAME));
  return stamp ? join(stamp, "..") : undefined;
}

/**
 * 型定義を設定ディレクトリへ同期する。stampが一致すれば何もしない（エディタの再解析や
 * ファイル監視を無駄に起こさないため）。ディレクトリ自体をgitの管理から外す`.gitignore`も置き、
 * dotfilesで設定を管理しているユーザーが除外設定を書かずに済むようにする。
 * 設定ディレクトリが無いユーザー（設定ファイル未作成）には何も作らない。
 * 同期したらtrueを返す
 */
export async function syncConfigTypes(configDir: string, buildDir: string): Promise<boolean> {
  if (!(await isExistingDir(configDir))) return false;
  const typesDir = join(configDir, CONFIG_TYPES_DIR_NAME);
  const wanted = await readFile(join(buildDir, STAMP_FILE_NAME), "utf8");
  const current = await readFile(join(typesDir, STAMP_FILE_NAME), "utf8").catch(() => null);
  if (current === wanted) return false;
  // 古い版にしか無いファイルを残さないよう作り直す。消すのはアプリが管理するこのディレクトリだけ
  await rm(typesDir, { recursive: true, force: true });
  await mkdir(typesDir, { recursive: true });
  await writeFile(join(typesDir, ".gitignore"), "*\n");
  const buildStamp = join(buildDir, STAMP_FILE_NAME);
  await cp(buildDir, typesDir, { recursive: true, filter: (src) => src !== buildStamp });
  // stampは最後に書く。途中で失敗したら次回の起動でやり直させるため
  await writeFile(join(typesDir, STAMP_FILE_NAME), wanted);
  return true;
}

async function isExistingDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
