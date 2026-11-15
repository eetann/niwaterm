// 設定ディレクトリ(~/.config/niwaterm/)の初期セットアップ。
// テンプレートはpackages/config/examples/を実体として使い、内容の重複を避ける
// （examplesを更新すればinitにもそのまま反映される）。
//
// 設定ディレクトリの解決ロジックはsrc/bun/config.tsのconfigDirPath()と、型定義の同期は
// src/bun/config-module.tsのsyncConfigTypes()と同じ内容だが、このパッケージは別ワークスペース
// パッケージでsrc/bunをimportできないため、意図的に重複させている
// （ipc-client.tsのipcSocketPath()と同じ方針）。変更時は必ず両方を揃えること。

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { define } from "gunshi";

function configDirPath(): string {
  const override = process.env["NIWATERM_CONFIG_DIR"];
  if (override) return resolve(override);
  return join(homedir(), ".config", "niwaterm");
}

const EXAMPLES_DIR = join(import.meta.dir, "../../../config/examples");
// このCLIはnpm未公開でリポジトリ内のソースをそのまま`bin`として実行する構成のため、
// アプリのビルド時に生成される型定義（scripts/build-config-types.ts）をリポジトリから直接読める
const CONFIG_TYPES_BUILD_DIR = resolve(import.meta.dir, "../../../../.config-types-build");
const CONFIG_TYPES_DIR_NAME = ".niwaterm-types";
const STAMP_FILE_NAME = "stamp";

/** ファイルが存在しない場合のみ書き込む。既存ファイルは上書きしない（npm init等と同じ方針） */
async function writeIfAbsent(path: string, content: string): Promise<void> {
  if (await Bun.file(path).exists()) {
    console.log(`skip (already exists): ${path}`);
    return;
  }
  await Bun.write(path, content);
  console.log(`created: ${path}`);
}

/**
 * エディタ向けの型定義を設定ディレクトリへ置く。アプリも起動時に同じことをするが、
 * 起動中のアプリは設定ディレクトリが後から作られても同期しないため、ここでも置いておく
 */
async function syncConfigTypes(dir: string): Promise<boolean> {
  const wanted = await readFile(join(CONFIG_TYPES_BUILD_DIR, STAMP_FILE_NAME), "utf8").catch(
    () => null,
  );
  if (wanted === null) return false;
  const typesDir = join(dir, CONFIG_TYPES_DIR_NAME);
  const current = await readFile(join(typesDir, STAMP_FILE_NAME), "utf8").catch(() => null);
  if (current === wanted) return true;
  await rm(typesDir, { recursive: true, force: true });
  await mkdir(typesDir, { recursive: true });
  await writeFile(join(typesDir, ".gitignore"), "*\n");
  const buildStamp = join(CONFIG_TYPES_BUILD_DIR, STAMP_FILE_NAME);
  await cp(CONFIG_TYPES_BUILD_DIR, typesDir, {
    recursive: true,
    filter: (src) => src !== buildStamp,
  });
  await writeFile(join(typesDir, STAMP_FILE_NAME), wanted);
  return true;
}

export default define({
  name: "init",
  description:
    "設定ディレクトリ(~/.config/niwaterm/、NIWATERM_CONFIG_DIRで変更可)をテンプレートからセットアップする",
  run: async () => {
    const dir = configDirPath();
    await mkdir(dir, { recursive: true });

    // examples/tsconfig.jsonはリポジトリ内でexamplesを型チェックするためのものなので使わない。
    // 設定ディレクトリでは中身を全部アプリが生成する側へ寄せ、版が変わってもユーザーが書き換えずに済むようにする
    await writeIfAbsent(
      join(dir, "tsconfig.json"),
      `{ "extends": "./${CONFIG_TYPES_DIR_NAME}/tsconfig.json" }\n`,
    );
    await writeIfAbsent(
      join(dir, "niwaterm.config.ts"),
      await Bun.file(join(EXAMPLES_DIR, "niwaterm.config.ts")).text(),
    );

    if (await syncConfigTypes(dir)) {
      console.log(`synced: ${join(dir, CONFIG_TYPES_DIR_NAME)}`);
    } else {
      console.log("型定義は、niwatermを次に起動したときに置かれます");
    }

    console.log(`\nSetup complete: ${dir}`);
    console.log("niwaterm.config.ts を編集後、保存すると自動で反映されます（ホットリロード）。");
  },
});
