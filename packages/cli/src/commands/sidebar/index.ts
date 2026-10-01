import { define } from "gunshi";
import switchCommand from "./switch";

export default define({
  name: "sidebar",
  description: "サイドバーの操作（ワークスペース一覧・customViewのビュー切替）",
  subCommands: {
    switch: switchCommand,
  },
  run: () => {
    console.log('Run "niwa sidebar --help" for available subcommands.');
  },
});
