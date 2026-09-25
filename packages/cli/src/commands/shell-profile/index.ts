import { define } from "gunshi";
import listCommand from "./list";

export default define({
  name: "shell-profile",
  description: "シェルプロファイル（tab new --shell・レイアウトプリセットで指定するid）の一覧表示",
  subCommands: {
    list: listCommand,
  },
  run: () => {
    console.log('Run "niwaterm shell-profile --help" for available subcommands.');
  },
});
