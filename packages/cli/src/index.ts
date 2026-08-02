#!/usr/bin/env bun
import { cli, define } from "gunshi";
import browserGetHtmlCommand from "./commands/browser-get-html";
import browserGetTextCommand from "./commands/browser-get-text";
import browserNavigateCommand from "./commands/browser-navigate";
import browserScreenshotCommand from "./commands/browser-screenshot";
import captureTabCommand from "./commands/capture-tab";
import closeTabCommand from "./commands/close-tab";
import focusTileCommand from "./commands/focus-tile";
import getVarCommand from "./commands/get-var";
import listCommand from "./commands/list";
import listVarsCommand from "./commands/list-vars";
import newTabCommand from "./commands/new-tab";
import pingCommand from "./commands/ping";
import sendKeysCommand from "./commands/send-keys";
import setVarCommand from "./commands/set-var";
import showTabCommand from "./commands/show-tab";
import splitTileCommand from "./commands/split-tile";
import switchTabCommand from "./commands/switch-tab";

const mainCommand = define({
  name: "niwaterm",
  description: "niwatermターミナルアプリをCLIから操作する",
  run: () => {
    console.log('Run "niwaterm --help" for available commands');
  },
});

await cli(process.argv.slice(2), mainCommand, {
  name: "niwaterm",
  version: "0.0.1",
  description: "niwatermターミナルアプリをCLIから操作する",
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
    "show-tab": showTabCommand,
    "capture-tab": captureTabCommand,
    "set-var": setVarCommand,
    "get-var": getVarCommand,
    "list-vars": listVarsCommand,
  },
});
