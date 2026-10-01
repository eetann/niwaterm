import { define } from "gunshi";
import promptCommand from "./prompt";

export default define({
  name: "claude",
  description: "そのタブで動いているClaude Codeのセッション（transcript）を参照する",
  subCommands: { prompt: promptCommand },
  run: () => {
    console.log('Run "niwa claude prompt --help" for available subcommands.');
  },
});
