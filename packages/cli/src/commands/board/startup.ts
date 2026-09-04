import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { type BoardStartupMode, resolveIpcEndpoint, setBoardStartup } from "../../ipc-client";
import { confirmTrust } from "../../layout-trust";

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
        "紐づけるプリセット名（niwaterm layout listで確認）。省略時は現在紐づいているプリセット（解決元込み）を引き継ぐ",
    },
    cwd: {
      type: "string",
      description:
        "--presetの解決元を探す起点ディレクトリ（省略時はこのコマンドを実行したディレクトリ）",
    },
    trust: {
      type: "boolean",
      description:
        "プロジェクトローカルのプリセットを紐づける際の確認をスキップする（非対話環境用）",
    },
  },
  run: async (ctx) => {
    const mode = ctx.values.mode;
    if (!isMode(mode)) {
      failAndExit(
        `board startupに失敗しました: modeは${MODES.join(" / ")}のいずれかを指定してください`,
      );
    }
    const endpoint = resolveIpcEndpoint();
    const setOnce = (trust: boolean | undefined) =>
      setBoardStartup(endpoint, mode, {
        boardId: ctx.values.board,
        preset: ctx.values.preset,
        cwd: ctx.values.cwd ?? process.cwd(),
        trust,
      });

    let result = await setOnce(ctx.values.trust);
    // プロジェクトローカル由来のプリセットを起動時レイアウトへ紐づけるにはtrustが要る
    if (!result.ok && "needsTrust" in result) {
      if (!(await confirmTrust(result.needsTrust))) {
        console.log("キャンセルしました");
        return;
      }
      result = await setOnce(true);
    }
    if (!result.ok) {
      failAndExit(`board startupに失敗しました: ${result.error}`);
    }
    if (result.startup === null) {
      console.log(`board: ${result.boardId}\tstartup: none`);
      return;
    }
    const source = result.startup.projectRoot ? ` [project: ${result.startup.projectRoot}]` : "";
    console.log(
      `board: ${result.boardId}\tpreset: ${result.startup.preset}${source}\tmode: ${result.startup.restoreMode}`,
    );
  },
});
