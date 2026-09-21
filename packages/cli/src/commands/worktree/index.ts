import { define } from "gunshi";
import listCommand from "./list";
import newCommand from "./new";
import openCommand from "./open";
import removeCommand from "./remove";

export default define({
  name: "worktree",
  description: "gitのワークツリーに関する操作",
  subCommands: {
    new: newCommand,
    open: openCommand,
    list: listCommand,
    remove: removeCommand,
  },
  run: () => {
    console.log('Run "niwaterm worktree --help" for available subcommands.');
  },
});
