// Claude Codeのタブの端に「線だけの目次」を出し、選んだプロンプトへClaude Codeの表示を飛ばす。
//
// 画面を動かせるのはClaude Code自身だけで、niwaterm側から位置を触る余地は無い
// （alternate screenで動くためスクロールバックに会話が1行も残らない。詳細は
// docs/known-issues/claude-code-history-not-in-scrollback.md）。そのため、ここでは
// ジャンプ先のuuidをタブ変数へ置き、mod/のButtonを押すキーを送るところまでを担う。

import type { HoverButtonContext, HoverButtonItem, Niwa } from "@niwaterm/config";

/** PATHにあるniwaterm CLIのコマンド名。devビルドで試すなら"niwaterm-dev"に変える */
const CLI = "niwaterm";

/** ジャンプ先のプロンプトのuuidを渡すタブ変数。modが`niwaterm tab var get`で読む */
const JUMP_VAR = "agent_jump";

/**
 * modがプロンプト上の帯へ置いたButtonを押すキー。既定はClaude Codeの`app:openArtifact`に
 * 割り当てられたキー（ctrl+]）で、mod側の`action`を変えたらこちらも揃える
 */
const JUMP_KEY = "C-]";

/** 目次の項目に出すツールチップの文字数。長いプロンプトはここで切る */
const TOOLTIP_CHARS = 140;

interface ClaudePrompt {
  index: number;
  uuid: string;
  text: string;
}

/**
 * OSCシーケンス（ESC ] ... BEL / ESC \）を取り除く。shell.runはログイン・インタラクティブシェル
 * 経由でコマンドを実行するため、シェル統合を入れているとプロンプトフックが出すOSC 7（cwd通知）が
 * 標準出力へ紛れ込み、そのままだとJSONのパースに失敗する
 */
function stripOsc(text: string): string {
  return text.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "");
}

async function runCli(niwa: Niwa, args: string): Promise<string> {
  const result = await niwa.shell.run(`${CLI} ${args}`);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${args} に失敗しました`);
  }
  return stripOsc(result.stdout).trim();
}

function tooltip(prompt: ClaudePrompt): string {
  const flat = prompt.text.replace(/\s+/g, " ").trim();
  const label =
    [...flat].length > TOOLTIP_CHARS ? `${[...flat].slice(0, TOOLTIP_CHARS).join("")}…` : flat;
  return `${prompt.index}. ${label}`;
}

/**
 * このタブに目次の帯を張るか。タブ変数だけを見る軽い判定にする
 * （タブ変数・cwdが変わるたびに評価されるため）
 */
export function claudePromptShow(ctx: HoverButtonContext): boolean {
  return ctx.vars.agent === "claude-code" && Boolean(ctx.vars.agent_transcript);
}

/**
 * 目次の項目。AIチャットのサイドにある「文字無しの線だけの目次」に倣って、
 * 1プロンプト＝1本の線にする。何のプロンプトかはツールチップで読む
 */
export async function claudePromptItems(
  ctx: HoverButtonContext,
  niwa: Niwa,
): Promise<HoverButtonItem[]> {
  const prompts: ClaudePrompt[] = JSON.parse(
    await runCli(niwa, `claude prompt list --json --tab ${ctx.tabId}`),
  );
  return prompts.map((prompt) => ({
    label: String(prompt.index),
    html: '<span class="claude-prompt-jump-tick"></span>',
    tooltip: tooltip(prompt),
    // transcriptのuuidはmodから見たプロンプト行のrequestIdと同じ値なので、そのまま渡せる
    run: () => {
      niwa.tab.var.set(ctx.tabId, JUMP_VAR, prompt.uuid);
      niwa.tab.sendKeys(ctx.tabId, JUMP_KEY);
    },
  }));
}

/** itemsのhtmlから参照するCSS。class名にidを含めてniwaterm本体と衝突させない */
export const claudePromptCss = `
.claude-prompt-jump-tick {
  display: block;
  width: 14px;
  height: 2px;
  border-radius: 1px;
  background: currentColor;
  opacity: 0.45;
}
.claude-prompt-jump-tick:hover {
  opacity: 1;
}
`;
