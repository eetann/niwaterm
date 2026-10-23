import { getAgentProfile } from "gunshi/agent";

/**
 * 実行中のコマンド名。devワークツリーのラッパーは`exec bun <entry>`の形なので
 * process.argv[1]からは起動名を復元できず、環境変数で受け取る
 */
export function cliName(): string {
  return process.env["NIWATERM_CLI_NAME"] || "niwa";
}

/** ドキュメントコマンドへの導線。helpのフッター・--version・エラー時に出す */
export function docsHintLine(): string {
  const name = cliName();
  return `ドキュメント: "${name} docs list" で一覧、"${name} docs show <name>" で詳細を読めます。`;
}

/** AIエージェントから実行されているか（gunshiがAI_AGENT・CLAUDECODE等の環境変数で判定する） */
export function isAgentRun(): boolean {
  return getAgentProfile().isAgent;
}

/**
 * エージェント実行時だけ導線をstderrへ出す。
 * エージェントは出力を読み飛ばさないので導線が効くが、人間には毎回のノイズになるため
 */
export function printDocsHintForAgent(): void {
  if (isAgentRun()) console.error(docsHintLine());
}
