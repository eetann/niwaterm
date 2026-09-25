import { define } from "gunshi";
import clearCommand from "./clear";
import setCommand from "./set";
import showCommand from "./show";

export default define({
  name: "phase",
  description: "Boardの作業フェーズ（サイドバーのバッジ）を設定・解除・表示する",
  subCommands: { set: setCommand, clear: clearCommand, show: showCommand },
  run: () => {
    console.log('Run "niwaterm board phase set/clear/show --help" for details.');
  },
});
