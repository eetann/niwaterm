import { define } from "gunshi";
import closeCommand from "./close";
import moveCommand from "./move";
import newCommand from "./new";
import phaseCommand from "./phase";
import renameCommand from "./rename";
import startupCommand from "./startup";
import switchCommand from "./switch";
import worktreeCommand from "./worktree";

export default define({
  name: "board",
  description:
    "Boardの作成・切替・削除・名前変更・並び替え・作業フェーズ・起動時レイアウト・ワークツリー紐づけ設定",
  subCommands: {
    new: newCommand,
    close: closeCommand,
    switch: switchCommand,
    rename: renameCommand,
    move: moveCommand,
    phase: phaseCommand,
    startup: startupCommand,
    worktree: worktreeCommand,
  },
  run: () => {
    console.log('Run "niwaterm board --help" for available subcommands.');
  },
});
