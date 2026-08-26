import { define } from "gunshi";
import findCommand from "./find";
import getCommand from "./get";
import listCommand from "./list";
import setCommand from "./set";

export default define({
  name: "var",
  description: "タブごとのkey-value変数を取得・設定・一覧・検索する（tmuxのペイン変数相当）",
  subCommands: { get: getCommand, set: setCommand, list: listCommand, find: findCommand },
  run: () => {
    console.log('Run "niwaterm tab var get/set/list/find --help" for details.');
  },
});
