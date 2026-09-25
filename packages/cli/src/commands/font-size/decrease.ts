import { define } from "gunshi";
import { runFontSize } from "./run";

export default define({
  name: "decrease",
  description: "ターミナルのフォントサイズを縮小する",
  run: () => runFontSize("decrease", "font-size decrease"),
});
