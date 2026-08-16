import { define } from "gunshi";
import focusCommand from "./focus";
import resizeCommand from "./resize";
import splitCommand from "./split";

export default define({
  name: "tile",
  description: "タイルの分割・フォーカス移動・リサイズ",
  subCommands: { split: splitCommand, focus: focusCommand, resize: resizeCommand },
  run: () => {
    console.log('Run "niwaterm tile --help" for available subcommands.');
  },
});
