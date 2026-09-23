// 設定ディレクトリ(~/.config/niwaterm/)の初期セットアップ。
// docs/guide/config.mdの手動セットアップ手順（package.json/tsconfig.json/niwaterm.config.tsの
// 3ファイル配置 + bun install）を自動化する。テンプレートはpackages/config/examples/を実体として使い、
// 内容の重複を避ける（examplesを更新すればinitにもそのまま反映される）。
//
// 設定ディレクトリの解決ロジックはsrc/bun/config.tsのconfigDirPath()と同じ内容だが、
// このパッケージは別ワークスペースパッケージでsrc/bunをimportできないため、意図的に重複させている
// （ipc-client.tsのipcSocketPath()と同じ方針）。変更時は必ず両方を揃えること。

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { define } from "gunshi";
import { failAndExit } from "../cli-error";

function configDirPath(): string {
  const override = process.env["NIWATERM_CONFIG_DIR"];
  if (override) return resolve(override);
  return join(homedir(), ".config", "niwaterm");
}

const EXAMPLES_DIR = join(import.meta.dir, "../../../config/examples");
// このCLIはnpm未公開でリポジトリ内のソースをそのまま`bin`として実行する構成のため、
// packages/configへの絶対パスをimport.meta.dirから動的に解決できる
// （examples/package.jsonのfile:参照はプレースホルダーパスのままなのでここで実パスへ差し替える）。
const CONFIG_PACKAGE_DIR = resolve(import.meta.dir, "../../../config");
const PLACEHOLDER_FILE_DEP = "file:/path/to/niwaterm/packages/config";

/** ファイルが存在しない場合のみ書き込む。既存ファイルは上書きしない（npm init等と同じ方針） */
async function writeIfAbsent(path: string, content: string): Promise<void> {
  if (await Bun.file(path).exists()) {
    console.log(`skip (already exists): ${path}`);
    return;
  }
  await Bun.write(path, content);
  console.log(`created: ${path}`);
}

export default define({
  name: "init",
  description:
    "設定ディレクトリ(~/.config/niwaterm/、NIWATERM_CONFIG_DIRで変更可)をテンプレートからセットアップする",
  args: {
    "skip-install": {
      type: "boolean",
      description: "生成後の `bun install` 実行をスキップする",
    },
  },
  run: async (ctx) => {
    const dir = configDirPath();
    await mkdir(dir, { recursive: true });

    const packageJson = await Bun.file(join(EXAMPLES_DIR, "package.json")).text();
    // Windowsのバックスラッシュ区切りパスはfile:依存として解釈が不安定なため、スラッシュへ統一する
    const filePath = CONFIG_PACKAGE_DIR.replaceAll("\\", "/");
    await writeIfAbsent(
      join(dir, "package.json"),
      packageJson.replace(PLACEHOLDER_FILE_DEP, `file:${filePath}`),
    );
    await writeIfAbsent(
      join(dir, "tsconfig.json"),
      await Bun.file(join(EXAMPLES_DIR, "tsconfig.json")).text(),
    );
    await writeIfAbsent(
      join(dir, "niwaterm.config.ts"),
      await Bun.file(join(EXAMPLES_DIR, "niwaterm.config.ts")).text(),
    );

    if (ctx.values["skip-install"]) {
      console.log(`\n次のコマンドで依存をインストールしてください: cd ${dir} && bun install`);
      return;
    }

    console.log("\nRunning bun install...");
    const proc = Bun.spawn(["bun", "install"], {
      cwd: dir,
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      failAndExit(`initに失敗しました: bun install がexit code ${exitCode}で終了しました`);
    }

    console.log(`\nSetup complete: ${dir}`);
    console.log("niwaterm.config.ts を編集後、保存すると自動で反映されます（ホットリロード）。");
  },
});
