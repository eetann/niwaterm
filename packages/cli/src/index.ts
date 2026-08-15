#!/usr/bin/env bun
import { cli, define } from "gunshi";
import { failAndExit } from "./cli-error";
import browserGetHtmlCommand from "./commands/browser-get-html";
import browserGetTextCommand from "./commands/browser-get-text";
import browserNavigateCommand from "./commands/browser-navigate";
import browserScreenshotCommand from "./commands/browser-screenshot";
import captureTabCommand from "./commands/capture-tab";
import closeTabCommand from "./commands/close-tab";
import closeWorkspaceCommand from "./commands/close-workspace";
import docsCommand from "./commands/docs";
import focusDirectionCommand from "./commands/focus-direction";
import focusTileCommand from "./commands/focus-tile";
import getVarCommand from "./commands/get-var";
import layoutCommand from "./commands/layout";
import listCommand from "./commands/list";
import listVarsCommand from "./commands/list-vars";
import newTabCommand from "./commands/new-tab";
import newWorkspaceCommand from "./commands/new-workspace";
import pingCommand from "./commands/ping";
import popupCommand from "./commands/popup";
import popupCloseCommand from "./commands/popup-close";
import popupPromoteCommand from "./commands/popup-promote";
import popupToggleCommand from "./commands/popup-toggle";
import renameWorkspaceCommand from "./commands/rename-workspace";
import sendKeysCommand from "./commands/send-keys";
import setVarCommand from "./commands/set-var";
import shellProfilesCommand from "./commands/shell-profiles";
import showTabCommand from "./commands/show-tab";
import splitTileCommand from "./commands/split-tile";
import switchTabCommand from "./commands/switch-tab";
import switchWorkspaceCommand from "./commands/switch-workspace";

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
      list: listCommand,
      "send-keys": sendKeysCommand,
      "browser-navigate": browserNavigateCommand,
      "browser-get-text": browserGetTextCommand,
      "browser-get-html": browserGetHtmlCommand,
      "browser-screenshot": browserScreenshotCommand,
      "split-tile": splitTileCommand,
      "new-tab": newTabCommand,
      "switch-tab": switchTabCommand,
      "close-tab": closeTabCommand,
      "focus-tile": focusTileCommand,
      "focus-direction": focusDirectionCommand,
      "new-workspace": newWorkspaceCommand,
      "switch-workspace": switchWorkspaceCommand,
      "close-workspace": closeWorkspaceCommand,
      "rename-workspace": renameWorkspaceCommand,
      "show-tab": showTabCommand,
      "capture-tab": captureTabCommand,
      popup: popupCommand,
      "popup-close": popupCloseCommand,
      "popup-promote": popupPromoteCommand,
      "popup-toggle": popupToggleCommand,
      "set-var": setVarCommand,
      "get-var": getVarCommand,
      "list-vars": listVarsCommand,
      "shell-profiles": shellProfilesCommand,
      layout: layoutCommand,
      docs: docsCommand,
    },
  });
} catch (err) {
  // gunshi自身のバリデーションエラー（例: 必須positional未指定）はmessageが空文字列で
  // 投げられ、かつ既にgunshiがエラー内容をコンソール出力済みのため、その場合は上乗せしない
  const message = err instanceof Error ? err.message : String(err);
  failAndExit(message ? `niwaterm: コマンドの実行中にエラーが発生しました: ${message}` : "");
}
