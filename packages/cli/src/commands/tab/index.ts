import { define } from "gunshi";
import captureCommand from "./capture";
import closeCommand from "./close";
import newCommand from "./new";
import sendKeysCommand from "./send-keys";
import showCommand from "./show";
import switchCommand from "./switch";
import varCommand from "./var";

export default define({
  name: "tab",
  description: "タブの作成・切替・削除・キー送信・変数操作など、タブに関する操作",
  subCommands: {
    new: newCommand,
    close: closeCommand,
    switch: switchCommand,
    show: showCommand,
    capture: captureCommand,
    "send-keys": sendKeysCommand,
    var: varCommand,
  },
  run: () => {
    console.log('Run "niwaterm tab --help" for available subcommands.');
  },
});
