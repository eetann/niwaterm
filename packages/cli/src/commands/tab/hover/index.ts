import { define } from "gunshi";
import hideCommand from "./hide";
import listCommand from "./list";
import revealCommand from "./reveal";

export default define({
  name: "hover",
  description: "タブの端に出るホバーボタン（設定のhoverButtons）を確認・強制表示する",
  subCommands: { list: listCommand, reveal: revealCommand, hide: hideCommand },
  run: () => {
    console.log('Run "niwa tab hover list/reveal/hide --help" for details.');
  },
});
