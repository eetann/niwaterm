import { define } from "gunshi";
import listCommand from "./list";

export default define({
  name: "worktree",
  description: "gitのワークツリーに関する操作",
  subCommands: {
    list: listCommand,
  },
  run: () => {
    console.log('Run "niwaterm worktree --help" for available subcommands.');
  },
});
