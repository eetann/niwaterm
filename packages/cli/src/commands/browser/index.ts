import { define } from "gunshi";
import getHtmlCommand from "./get-html";
import getTextCommand from "./get-text";
import navigateCommand from "./navigate";
import screenshotCommand from "./screenshot";

export default define({
  name: "browser",
  description: "ブラウザタブのURL遷移・内容取得・スクリーンショット取得",
  subCommands: {
    navigate: navigateCommand,
    "get-html": getHtmlCommand,
    "get-text": getTextCommand,
    screenshot: screenshotCommand,
  },
  run: () => {
    console.log('Run "niwaterm browser --help" for available subcommands.');
  },
});
