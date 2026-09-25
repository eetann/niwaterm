import { failAndExit } from "../../cli-error";
import { adjustFontSize, type FontSizeAction, resolveIpcEndpoint } from "../../ipc-client";

/** increase/decrease/resetで共通の送信・出力処理。commandNameはエラー文言用のフルコマンド名 */
export async function runFontSize(action: FontSizeAction, commandName: string): Promise<void> {
  const result = await adjustFontSize(resolveIpcEndpoint(), action);
  if (!result.ok) {
    failAndExit(`${commandName}に失敗しました: ${result.error}`);
  }
  console.log(`font size: ${result.fontSize}px`);
}
