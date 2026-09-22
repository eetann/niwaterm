import { define } from "gunshi";
import showCommand from "./show";

export default define({
  name: "config",
  description: "設定値の確認",
  subCommands: {
    show: showCommand,
  },
  run: () => {
    console.log('Run "niwaterm config --help" for available subcommands.');
  },
});
