import { define } from "gunshi";
import listCommand from "./list";
import newCommand from "./new";

export default define({
  name: "worktree",
  description: "gitのワークツリーに関する操作",
  subCommands: {
    new: newCommand,
    list: listCommand,
  },
  run: () => {
    console.log('Run "niwaterm worktree --help" for available subcommands.');
  },
});
