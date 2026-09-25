#!/usr/bin/env bun
import { cli, define } from "gunshi";
import { renderUsage } from "gunshi/renderer";
import { cliName, docsHintLine } from "./agent-hint";
import { failAndExit } from "./cli-error";
import agentCommand from "./commands/agent";
import boardCommand from "./commands/board";
import browserCommand from "./commands/browser";
import configCommand from "./commands/config";
import docsCommand from "./commands/docs";
import fontSizeCommand from "./commands/font-size";
import initCommand from "./commands/init";
import keybindCommand from "./commands/keybind";
import layoutCommand from "./commands/layout";
import listCommand from "./commands/list";
import notifyCommand from "./commands/notify";
import pingCommand from "./commands/ping";
import popupCommand from "./commands/popup";
import shellProfileCommand from "./commands/shell-profile";
import sidebarCommand from "./commands/sidebar";
import tabCommand from "./commands/tab";
import tileCommand from "./commands/tile";
import windowCommand from "./commands/window";
import workspaceCommand from "./commands/workspace";
import worktreeCommand from "./commands/worktree";

const DESCRIPTION = "niwatermターミナルアプリをCLIから操作する";
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
    // ctx.env.renderUsageはサブコマンドのヘルプでも使われるため、ここだけで全ヘルプに導線が付く
    renderUsage: async (ctx) => `${await renderUsage(ctx)}\n\n${docsHintLine()}`,
    subCommands: {
      agent: agentCommand,
      ping: pingCommand,
      init: initCommand,
      list: listCommand,
      notify: notifyCommand,
      tab: tabCommand,
      window: windowCommand,
      workspace: workspaceCommand,
      board: boardCommand,
      worktree: worktreeCommand,
      tile: tileCommand,
      keybind: keybindCommand,
      config: configCommand,
      popup: popupCommand,
      browser: browserCommand,
      sidebar: sidebarCommand,
      "shell-profile": shellProfileCommand,
      layout: layoutCommand,
      "font-size": fontSizeCommand,
      docs: docsCommand,
    },
  });
} catch (err) {
  // gunshi自身のバリデーションエラー（例: 必須positional未指定）はmessageが空文字列で
  // 投げられ、かつ既にgunshiがエラー内容をコンソール出力済みのため、その場合は上乗せしない
  const message = err instanceof Error ? err.message : String(err);
  failAndExit(message ? `niwaterm: コマンドの実行中にエラーが発生しました: ${message}` : "");
}
