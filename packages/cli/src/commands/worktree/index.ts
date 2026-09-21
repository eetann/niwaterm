import { define } from "gunshi";
import listCommand from "./list";
import newCommand from "./new";
import openCommand from "./open";

export default define({
  name: "worktree",
  description: "gitのワークツリーに関する操作",
  subCommands: {
    new: newCommand,
    open: openCommand,
    list: listCommand,
  },
  run: () => {
    console.log('Run "niwaterm worktree --help" for available subcommands.');
  },
});
