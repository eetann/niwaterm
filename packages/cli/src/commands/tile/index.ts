import { define } from "gunshi";
import focusCommand from "./focus";
import splitCommand from "./split";

export default define({
  name: "tile",
  description: "タイルの分割・フォーカス移動",
  subCommands: { split: splitCommand, focus: focusCommand },
  run: () => {
    console.log('Run "niwaterm tile --help" for available subcommands.');
  },
});
