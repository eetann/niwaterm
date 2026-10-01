import { define } from "gunshi";
import listCommand from "./list";
import showCommand from "./show";

export default define({
  name: "prompt",
  description: "Claude Codeのtranscriptから、打ったプロンプトを一覧・表示する",
  subCommands: { list: listCommand, show: showCommand },
  run: () => {
    console.log('Run "niwa claude prompt list/show --help" for details.');
  },
});
