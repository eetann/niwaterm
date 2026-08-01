import { define } from "gunshi";
import { ipcSocketPath, setTileVar } from "../ipc-client";

export default define({
  name: "set-var",
  description: "指定したタイルにkey-value変数を設定する（tmuxのペイン変数相当）",
  args: {
    tile: {
      type: "string",
      short: "t",
      required: true,
      description: "対象のtileId（niwaterm listで確認）",
    },
    key: {
      type: "positional",
      description: "変数名（英数字・_・-・.のみ、1〜128文字）",
    },
    value: {
      type: "positional",
      description: "設定する値",
    },
  },
  run: async (ctx) => {
    const result = await setTileVar(
      ipcSocketPath(),
      ctx.values.tile,
      ctx.values.key,
      ctx.values.value,
    );
    if (!result.ok) {
      console.error(`set-varに失敗しました: ${result.error}`);
      process.exit(1);
    }
  },
});
