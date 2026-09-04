import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { type BoardStartupMode, resolveIpcEndpoint, setBoardStartup } from "../../ipc-client";

const MODES: BoardStartupMode[] = ["layout", "restore", "clear"];

function isMode(value: string): value is BoardStartupMode {
  return (MODES as string[]).includes(value);
}

export default define({
  name: "startup",
  description: "起動時にBoardをレイアウトプリセットで組み直すかを設定する",
  args: {
    mode: {
      type: "positional",
      description:
        "layout: 起動時にプリセットで組み直す（commandも再実行される） / restore: 保存した骨格を復元する（既定） / clear: プリセットの紐づけを解除する",
    },
    board: {
      type: "string",
      short: "b",
      description: "対象のboardId（省略時は現在アクティブなBoard）",
    },
    preset: {
      type: "string",
      short: "p",
      description:
        "紐づけるプリセット名（niwaterm layout listで確認）。省略時は現在紐づいているプリセットを引き継ぐ",
    },
  },
  run: async (ctx) => {
    const mode = ctx.values.mode;
    if (!isMode(mode)) {
      failAndExit(
        `board startupに失敗しました: modeは${MODES.join(" / ")}のいずれかを指定してください`,
      );
    }
    const result = await setBoardStartup(
      resolveIpcEndpoint(),
      mode,
      ctx.values.board,
      ctx.values.preset,
    );
    if (!result.ok) {
      failAndExit(`board startupに失敗しました: ${result.error}`);
    }
    if (result.startup === null) {
      console.log(`board: ${result.boardId}\tstartup: none`);
      return;
    }
    console.log(
      `board: ${result.boardId}\tpreset: ${result.startup.preset}\tmode: ${result.startup.restoreMode}`,
    );
  },
});
