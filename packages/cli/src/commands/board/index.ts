import { define } from "gunshi";
import closeCommand from "./close";
import moveCommand from "./move";
import newCommand from "./new";
import phaseCommand from "./phase";
import renameCommand from "./rename";
import resumeCommand from "./resume";
import startupCommand from "./startup";
import switchCommand from "./switch";
import worktreeCommand from "./worktree";

export default define({
  name: "board",
  description:
    "Boardの作成・切替・削除・名前変更・並び替え・作業フェーズ・起動時レイアウト・起動時のコマンド再実行・ワークツリー紐づけ設定",
  subCommands: {
    new: newCommand,
    close: closeCommand,
    switch: switchCommand,
    rename: renameCommand,
    move: moveCommand,
    phase: phaseCommand,
    startup: startupCommand,
    resume: resumeCommand,
    worktree: worktreeCommand,
  },
  run: () => {
    console.log('Run "niwa board --help" for available subcommands.');
  },
});
