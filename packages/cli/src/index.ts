#!/usr/bin/env bun
import { cli, define } from "gunshi";
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
import shellProfilesCommand from "./commands/shell-profiles";
import tabCommand from "./commands/tab";
import tileCommand from "./commands/tile";
import workspaceCommand from "./commands/workspace";
import worktreeCommand from "./commands/worktree";

const DESCRIPTION = "niwatermターミナルアプリをCLIから操作する";

// hookの不正な引数も成功扱いにするため、通常の引数検証・ヘルプ表示を通さない。
if (process.argv[2] === "_hook") {
  const { runAgentHook } = await import("./agent-hook");
  await runAgentHook(process.argv[3]);
  process.exit(0);
}

const mainCommand = define({
  name: "niwaterm",
  description: DESCRIPTION,
  run: () => {
    console.log(
      'Run "niwaterm --help" for available commands, or "niwaterm docs show cli" for full docs',
    );
  },
});

try {
  await cli(process.argv.slice(2), mainCommand, {
    name: "niwaterm",
    version: "0.0.1",
    description: DESCRIPTION,
    renderHeader: null,
    subCommands: {
      agent: agentCommand,
      ping: pingCommand,
      init: initCommand,
      list: listCommand,
      notify: notifyCommand,
      tab: tabCommand,
      workspace: workspaceCommand,
      board: boardCommand,
      worktree: worktreeCommand,
      tile: tileCommand,
      keybind: keybindCommand,
      config: configCommand,
      popup: popupCommand,
      browser: browserCommand,
      "shell-profiles": shellProfilesCommand,
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
