import { define } from "gunshi";
import refreshCommand from "./refresh";
import toggleCommand from "./toggle";

export default define({
  name: "status-bar",
  description: "ウィンドウ下端のステータスバー（設定のstatusBar）の再描画・表示切り替え",
  subCommands: {
    refresh: refreshCommand,
    toggle: toggleCommand,
  },
  run: () => {
    console.log('Run "niwaterm status-bar --help" for available subcommands.');
  },
});
