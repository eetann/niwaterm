import { define } from "gunshi";
import clearCommand from "./clear";
import setCommand from "./set";
import showCommand from "./show";

export default define({
  name: "worktree",
  description: "Boardに紐づくワークツリーの設定・解除・表示",
  subCommands: { set: setCommand, clear: clearCommand, show: showCommand },
  run: () => {
    console.log('Run "niwaterm board worktree --help" for available subcommands.');
  },
});
