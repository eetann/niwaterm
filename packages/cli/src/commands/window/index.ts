import { define } from "gunshi";
import closeCommand from "./close";
import listCommand from "./list";
import newCommand from "./new";

export default define({
  name: "window",
  description: "OSウィンドウの作成・一覧・クローズ",
  subCommands: {
    new: newCommand,
    list: listCommand,
    close: closeCommand,
  },
  run: () => {
    console.log('Run "niwaterm window --help" for available subcommands.');
  },
});
