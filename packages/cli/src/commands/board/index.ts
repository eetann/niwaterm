import { define } from "gunshi";
import closeCommand from "./close";
import moveCommand from "./move";
import newCommand from "./new";
import renameCommand from "./rename";
import startupCommand from "./startup";
import statusCommand from "./status";
import switchCommand from "./switch";
import worktreeCommand from "./worktree";

export default define({
  name: "board",
  description:
    "Boardの作成・切替・削除・名前変更・並び替え・ステータス・起動時レイアウト・ワークツリー紐づけ設定",
  subCommands: {
    new: newCommand,
    close: closeCommand,
    switch: switchCommand,
    rename: renameCommand,
    move: moveCommand,
    status: statusCommand,
    startup: startupCommand,
    worktree: worktreeCommand,
  },
  run: () => {
    console.log('Run "niwaterm board --help" for available subcommands.');
  },
});
