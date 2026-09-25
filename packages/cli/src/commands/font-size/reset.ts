import { define } from "gunshi";
import { runFontSize } from "./run";

export default define({
  name: "reset",
  description: "ターミナルのフォントサイズを設定ファイルのappearance.fontSizeへ戻す",
  run: () => runFontSize("reset", "font-size reset"),
});
