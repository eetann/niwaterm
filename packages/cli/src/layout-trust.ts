// プロジェクトローカル（<projectRoot>/.niwaterm/config.ts）のレイアウトプリセットを
// 起動時レイアウトへ紐づける前の確認プロンプト。
//
// 紐づけると、以後アプリを起動するたびにそのリポジトリの.niwaterm/config.tsが評価され、
// プリセットのcommandがシェルへ流し込まれる。clone してきたリポジトリのコードが自動実行される
// ことになるため、紐づけを作る操作にだけ同意を挟む。
//
// 信頼の記録は別ストアを持たず、紐づけ（PersistedBoardStartup.projectRoot）そのものを信頼の記録とする。
// 起動時に自動実行される経路はこの紐づけ1本だけで、それは必ずこのプロンプトを通ってしか作られない。

import { createInterface } from "node:readline/promises";
import { failAndExit } from "./cli-error";
import type { LayoutTrustRequest } from "./ipc-client";

/**
 * y/Nで同意を取る。非対話環境（パイプ・スクリプト実行等）ではハングせずエラーで終了し、
 * --trustの利用を促す（layout.tsのconfirmReplaceと同じ方針）
 */
export async function confirmTrust(request: LayoutTrustRequest): Promise<boolean> {
  if (!process.stdin.isTTY) {
    failAndExit(
      `プロジェクトローカルのレイアウトプリセット "${request.preset}"（${request.projectRoot}）を起動時レイアウトに紐づけようとしています。非対話環境のため確認ができません。確認をスキップするには--trustを使ってください`,
    );
  }
  console.log(`起動時レイアウトに紐づけるプリセットは、このプロジェクトで定義されています:`);
  console.log(`  プリセット: ${request.preset}`);
  console.log(`  定義元: ${request.projectRoot}/.niwaterm/config.ts`);
  console.log(
    "紐づけると、niwatermを起動するたびにこのファイルが評価され、プリセットのcommandが実行されます。",
  );
  console.log("信頼できるリポジトリでのみ許可してください。");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("このプロジェクトを信頼して紐づけますか？ (y/N) ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
