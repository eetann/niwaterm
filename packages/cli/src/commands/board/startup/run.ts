import { failAndExit } from "../../../cli-error";
import { type BoardStartupMode, resolveIpcEndpoint, setBoardStartup } from "../../../ipc-client";
import { confirmTrust } from "../../../layout-trust";

export interface RunBoardStartupOptions {
  boardId?: string | undefined;
  preset?: string | undefined;
  cwd?: string | undefined;
  trust?: boolean | undefined;
}

/** layout/restore/clearで共通の送信・trust確認・出力処理。commandNameはエラー文言用のフルコマンド名 */
export async function runBoardStartup(
  mode: BoardStartupMode,
  commandName: string,
  opts: RunBoardStartupOptions,
): Promise<void> {
  const endpoint = resolveIpcEndpoint();
  const setOnce = (trust: boolean | undefined) =>
    setBoardStartup(endpoint, mode, {
      boardId: opts.boardId,
      preset: opts.preset,
      cwd: opts.cwd ?? process.cwd(),
      trust,
    });

  let result = await setOnce(opts.trust);
  // プロジェクトローカル由来のプリセットを起動時レイアウトへ紐づけるにはtrustが要る
  if (!result.ok && "needsTrust" in result) {
    if (!(await confirmTrust(result.needsTrust))) {
      console.log("キャンセルしました");
      return;
    }
    result = await setOnce(true);
  }
  if (!result.ok) {
    failAndExit(`${commandName}に失敗しました: ${result.error}`);
  }
  if (result.startup === null) {
    console.log(`board: ${result.boardId}\tstartup: none`);
    return;
  }
  const source = result.startup.projectRoot ? ` [project: ${result.startup.projectRoot}]` : "";
  console.log(
    `board: ${result.boardId}\tpreset: ${result.startup.preset}${source}\tmode: ${result.startup.restoreMode}`,
  );
}
