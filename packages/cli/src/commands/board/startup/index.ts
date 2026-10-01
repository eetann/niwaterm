import { define } from "gunshi";
import clearCommand from "./clear";
import layoutCommand from "./layout";
import restoreCommand from "./restore";

export default define({
  name: "startup",
  description: "起動時にBoardをレイアウトプリセットで組み直すかを設定する",
  subCommands: { layout: layoutCommand, restore: restoreCommand, clear: clearCommand },
  run: () => {
    console.log('Run "niwa board startup layout/restore/clear --help" for details.');
  },
});
