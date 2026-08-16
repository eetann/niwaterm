import { define } from "gunshi";
import closeCommand from "./close";
import openCommand from "./open";
import promoteCommand from "./promote";
import toggleCommand from "./toggle";

export default define({
  name: "popup",
  description:
    "タイル・タブに所属しない一時的なポップアップ画面の開閉・昇格・表示切替（tmuxのpopup/floating相当）",
  subCommands: {
    open: openCommand,
    close: closeCommand,
    promote: promoteCommand,
    toggle: toggleCommand,
  },
  run: () => {
    console.log('Run "niwaterm popup --help" for available subcommands.');
  },
});
