import { define } from "gunshi";
import { runFontSize } from "./run";

export default define({
  name: "increase",
  description: "ターミナルのフォントサイズを拡大する",
  run: () => runFontSize("increase", "font-size increase"),
});
