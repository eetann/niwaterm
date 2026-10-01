import { define } from "gunshi";
import focusCommand from "./focus";
import resizeCommand from "./resize";
import splitCommand from "./split";
import zoomCommand from "./zoom";

export default define({
  name: "tile",
  description: "タイルの分割・フォーカス移動・リサイズ・ズーム表示切替",
  subCommands: {
    split: splitCommand,
    focus: focusCommand,
    resize: resizeCommand,
    zoom: zoomCommand,
  },
  run: () => {
    console.log('Run "niwa tile --help" for available subcommands.');
  },
});
