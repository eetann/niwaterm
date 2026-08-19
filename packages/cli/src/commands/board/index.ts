import { define } from "gunshi";
import closeCommand from "./close";
import newCommand from "./new";
import renameCommand from "./rename";
import switchCommand from "./switch";

export default define({
  name: "board",
  description: "Boardの作成・切替・削除・名前変更",
  subCommands: {
    new: newCommand,
    close: closeCommand,
    switch: switchCommand,
    rename: renameCommand,
  },
  run: () => {
    console.log('Run "niwaterm board --help" for available subcommands.');
  },
});
