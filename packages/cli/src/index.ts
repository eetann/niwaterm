#!/usr/bin/env bun
import { cli, define } from "gunshi";
import listCommand from "./commands/list";
import pingCommand from "./commands/ping";
import sendKeysCommand from "./commands/send-keys";

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
  },
});
