import { define } from "gunshi";
import closeCommand from "./close";
import moveCommand from "./move";
import newCommand from "./new";
import renameCommand from "./rename";
import switchCommand from "./switch";

export default define({
  name: "workspace",
  description: "ワークスペースの作成・切替・削除・名前変更・並び替え",
  subCommands: {
    new: newCommand,
    close: closeCommand,
    switch: switchCommand,
    rename: renameCommand,
    move: moveCommand,
  },
  run: () => {
    console.log('Run "niwaterm workspace --help" for available subcommands.');
  },
});
