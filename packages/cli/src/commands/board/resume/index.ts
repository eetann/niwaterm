import { define } from "gunshi";
import clearCommand from "./clear";
import setCommand from "./set";
import showCommand from "./show";

export default define({
  name: "resume",
  description: "実行中だったコマンドを起動時に再実行するかを、Boardごとに切り替える",
  subCommands: { set: setCommand, clear: clearCommand, show: showCommand },
  run: () => {
    console.log('Run "niwa board resume set/clear/show --help" for details.');
  },
});
