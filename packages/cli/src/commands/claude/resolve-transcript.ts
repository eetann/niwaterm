// claude prompt list/show が共通で使うtranscript（jsonl）の解決。サブコマンドではない。
import { TRANSCRIPT_VAR } from "../../agent-hook";
import { parseJsonl, type TranscriptRow } from "../../claude-transcript";
import { failAndExit } from "../../cli-error";
import { listTabVars, resolveIpcEndpoint } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export interface TranscriptSelector {
  /** 対象のtabId。省略時はcreateTargetResolverのフォールバックに従う */
  tab?: string;
  /** transcript（jsonl）のパス。指定するとタブ変数を見ない */
  transcript?: string;
}

/**
 * transcriptを読んで行へ分解する。パスの指定が無ければ対象タブの`agent_transcript`から引く。
 * Claude Code側はhookの入力で絶対パスを渡してくるので、こちらでパスを組み立てることはしない
 */
export async function loadTranscript(
  commandName: string,
  selector: TranscriptSelector,
): Promise<TranscriptRow[]> {
  const path = selector.transcript ?? (await transcriptFromTab(commandName, selector.tab));
  const file = Bun.file(path);
  if (!(await file.exists())) {
    failAndExit(
      `${commandName}に失敗しました: transcriptが見つかりません: ${path}（Claude Codeのセッションが終わっているか、履歴が削除されています）`,
    );
  }
  return parseJsonl(await file.text());
}

async function transcriptFromTab(commandName: string, tab: string | undefined): Promise<string> {
  const endpoint = resolveIpcEndpoint();
  const target = createTargetResolver(endpoint, commandName, { tabId: tab });
  const tabId = await target.tabId();
  // 未設定の変数はget-varがエラーを返すため、一覧を引いて「まだ書かれていない」を自分で判定する
  const result = await listTabVars(endpoint, tabId);
  if (!result.ok) {
    failAndExit(`${commandName}に失敗しました: ${result.error}`);
  }
  const path = result.vars[TRANSCRIPT_VAR];
  if (!path) {
    failAndExit(
      `${commandName}に失敗しました: タブ${tabId}のtranscriptが分かりません。そのタブでClaude Codeを動かし、エージェント統合を入れてください（niwaterm agent setup claude-code）。--transcriptでjsonlのパスを直接渡すこともできます`,
    );
  }
  return path;
}
