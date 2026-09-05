#!/usr/bin/env bun
import { cli, define } from "gunshi";
import { failAndExit } from "./cli-error";
import boardCommand from "./commands/board";
import browserCommand from "./commands/browser";
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

const DESCRIPTION = "niwatermターミナルアプリをCLIから操作する";

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
      ping: pingCommand,
      init: initCommand,
      list: listCommand,
      notify: notifyCommand,
      tab: tabCommand,
      workspace: workspaceCommand,
      board: boardCommand,
      tile: tileCommand,
      keybind: keybindCommand,
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
