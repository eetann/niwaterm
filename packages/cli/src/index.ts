#!/usr/bin/env bun
import completion from "@gunshi/plugin-completion";
import { cli, define } from "gunshi";
import { renderUsage } from "gunshi/renderer";
import { cliName, docsHintLine } from "./agent-hint";
import { buildCompletionConfig, COMPLETION_SHELLS } from "./completion";
import { failAndExit } from "./cli-error";
import { subCommands } from "./commands";

const DESCRIPTION = "niwatermターミナルアプリをCLIから操作する";

/**
 * completeコマンドは@gunshi/plugin-completionが登録するもので、gunshiのaddCommandは
 * 同名の再登録を弾くため定義を差し替えられない。ヘルプの一覧だけ他のコマンドと同じ日本語へ揃える。
 * プラグイン側の文言が変わればここは素通りするが、英語の説明がそのまま出るだけで動作は変わらない
 */
const COMPLETE_DESCRIPTION: [string, string] = [
  "Generate shell completion script",
  "シェルの補完スクリプトを出力する（bash / zsh / fish / powershell）",
];
const VERSION = "0.0.1";

// `docs show cli | head`のようにパイプ先が先に閉じたとき、EPIPEで異常終了させない
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EPIPE") throw err;
});

// hookの不正な引数も成功扱いにするため、通常の引数検証・ヘルプ表示を通さない。
if (process.argv[2] === "_hook") {
  const { runAgentHook } = await import("./agent-hook");
  await runAgentHook(process.argv[3]);
  process.exit(0);
}

// 補完スクリプトが呼ぶコマンドをPATH上の名前（niwaterm・niwa-dev）へ寄せる。
// @gunshi/plugin-completionは実行中のbunバイナリとエントリの絶対パスをスクリプトへ埋め込むが、
// それだとniwa-devのラッパーが渡す接続先（NIWATERM_APP_VARIANT）が落ち、
// 開発中インスタンスを操作しているのに候補だけ普段遣いのインスタンスから引かれる。
// bun以外の名前で起動された場合は単一実行ファイルとみなして実行ファイル名だけを埋め込む
// 実装なので、名前を差し替えるとコマンド名だけが残る（判定が変われば絶対パスに戻るだけで壊れない）
if (process.argv[2] === "complete" && COMPLETION_SHELLS.has(process.argv[3] ?? "")) {
  process.execPath = cliName();
}

// gunshiのバージョン表示はctx.env.versionをそのまま出すだけで差し込む余地が無いため、
// cli()へ渡す前に処理する。導線はバージョン文字列をパースする側を壊さないようstderrへ出す
if (process.argv[2] === "-v" || process.argv[2] === "--version") {
  console.log(VERSION);
  console.error(docsHintLine());
  process.exit(0);
}

const mainCommand = define({
  name: cliName(),
  description: DESCRIPTION,
  run: () => {
    console.log(`"${cliName()} --help" でコマンド一覧を表示できます。`);
    console.log(docsHintLine());
  },
});

try {
  await cli(process.argv.slice(2), mainCommand, {
    name: cliName(),
    version: VERSION,
    description: DESCRIPTION,
    renderHeader: null,
    plugins: [completion({ config: await buildCompletionConfig(process.argv.slice(2)) })],
    // ctx.env.renderUsageはサブコマンドのヘルプでも使われるため、ここだけで全ヘルプに導線が付く
    renderUsage: async (ctx) =>
      `${(await renderUsage(ctx)).replace(...COMPLETE_DESCRIPTION)}\n\n${docsHintLine()}`,
    subCommands,
  });
} catch (err) {
  // gunshi自身のバリデーションエラー（例: 必須positional未指定）はmessageが空文字列で
  // 投げられ、かつ既にgunshiがエラー内容をコンソール出力済みのため、その場合は上乗せしない
  const message = err instanceof Error ? err.message : String(err);
  failAndExit(message ? `${cliName()}: コマンドの実行中にエラーが発生しました: ${message}` : "");
}
