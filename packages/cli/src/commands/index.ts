import agentCommand from "./agent";
import boardCommand from "./board";
import browserCommand from "./browser";
import configCommand from "./config";
import docsCommand from "./docs";
import fontSizeCommand from "./font-size";
import initCommand from "./init";
import keybindCommand from "./keybind";
import layoutCommand from "./layout";
import listCommand from "./list";
import notifyCommand from "./notify";
import pingCommand from "./ping";
import popupCommand from "./popup";
import shellProfileCommand from "./shell-profile";
import sidebarCommand from "./sidebar";
import tabCommand from "./tab";
import tileCommand from "./tile";
import windowCommand from "./window";
import workspaceCommand from "./workspace";
import worktreeCommand from "./worktree";

/**
 * cli()へ登録するサブコマンドのツリー。
 * 補完設定（completion/）が同じツリーを走査してコマンド名・引数名を引くため、
 * エントリポイントから切り出してここに置く
 */
export const subCommands = {
  agent: agentCommand,
  ping: pingCommand,
  init: initCommand,
  list: listCommand,
  notify: notifyCommand,
  tab: tabCommand,
  window: windowCommand,
  workspace: workspaceCommand,
  board: boardCommand,
  worktree: worktreeCommand,
  tile: tileCommand,
  keybind: keybindCommand,
  config: configCommand,
  popup: popupCommand,
  browser: browserCommand,
  sidebar: sidebarCommand,
  "shell-profile": shellProfileCommand,
  layout: layoutCommand,
  "font-size": fontSizeCommand,
  docs: docsCommand,
};
