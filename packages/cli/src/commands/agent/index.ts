import { define } from "gunshi";
import setupCommand from "./setup";

export default define({
  name: "agent",
  description: "AIエージェントとの連携設定",
  subCommands: { setup: setupCommand },
  run: () => {
    console.log('Run "niwa agent --help" for available subcommands.');
  },
});
