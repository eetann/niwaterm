import { define } from "gunshi";
import captureCommand from "./capture";
import closeCommand from "./close";
import focusCommand from "./focus";
import hoverCommand from "./hover";
import newCommand from "./new";
import restartCommand from "./restart";
import sendKeysCommand from "./send-keys";
import switchCommand from "./switch";
import varCommand from "./var";

export default define({
  name: "tab",
  description:
    "タブの作成・切替・削除・再起動・キー送信・変数操作・ホバーボタンの確認など、タブに関する操作",
  subCommands: {
    new: newCommand,
    close: closeCommand,
    restart: restartCommand,
    switch: switchCommand,
    focus: focusCommand,
    capture: captureCommand,
    "send-keys": sendKeysCommand,
    var: varCommand,
    hover: hoverCommand,
  },
  run: () => {
    console.log('Run "niwa tab --help" for available subcommands.');
  },
});
