import { define } from "gunshi";
import listCommand from "./list";

export default define({
  name: "keybind",
  description: "キーバインドの確認",
  subCommands: {
    list: listCommand,
  },
  run: () => {
    console.log('Run "niwa keybind --help" for available subcommands.');
  },
});
