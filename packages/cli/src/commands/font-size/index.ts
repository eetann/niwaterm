import { define } from "gunshi";
import decreaseCommand from "./decrease";
import increaseCommand from "./increase";
import resetCommand from "./reset";

export default define({
  name: "font-size",
  description:
    "ターミナルのフォントサイズを拡大・縮小・リセットする（configファイルのappearance.fontSizeは変更しない実行時ズーム）",
  subCommands: {
    increase: increaseCommand,
    decrease: decreaseCommand,
    reset: resetCommand,
  },
  run: () => {
    console.log('Run "niwaterm font-size increase/decrease/reset --help" for details.');
  },
});
