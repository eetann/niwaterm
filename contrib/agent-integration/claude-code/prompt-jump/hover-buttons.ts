// Claude Codeのタブの端にプロンプトの目次を出し、選んだプロンプトへClaude Codeの表示を飛ばす。
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

/** 項目の見た目。"text"は棒に本文の頭を添える、"bar"は棒だけにする */
const ITEM_STYLE: "text" | "bar" = "text";

/** "text"のときに項目へ出す本文の文字数 */
const LABEL_CHARS = 20;

/** 目次の項目に出すツールチップの文字数。長いプロンプトはここで切る */
const TOOLTIP_CHARS = 140;

/** 棒の長さ(px)の下限と上限 */
const BAR_MIN_PX = 6;
const BAR_MAX_PX = 44;

/** 棒が上限の長さになるプロンプトの文字数 */
const BAR_FULL_CHARS = 240;

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

/** htmlへ差し込む前に必ず通す。プロンプトの本文はniwaterm本体のwebviewへそのまま入るため */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function runCli(niwa: Niwa, args: string): Promise<string> {
  const result = await niwa.shell.run(`${CLI} ${args}`);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${args} に失敗しました`);
  }
  return stripOsc(result.stdout).trim();
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, chars: number): string {
  const glyphs = [...text];
  return glyphs.length > chars ? `${glyphs.slice(0, chars).join("")}…` : text;
}

/**
 * プロンプトの長さを棒の長さへ写す。`ok`のような一言と長文を見分けられるように、
 * 短いほうの差が潰れない平方根で割り当てる（線形だと長文側に寄って短文が全部同じになる）
 */
function barWidth(text: string): number {
  const ratio = Math.min(1, Math.sqrt([...text].length / BAR_FULL_CHARS));
  return Math.round(BAR_MIN_PX + (BAR_MAX_PX - BAR_MIN_PX) * ratio);
}

function itemHtml(prompt: ClaudePrompt): string {
  const flat = oneLine(prompt.text);
  const bar = `<span class="claude-prompt-jump-bar" style="width: ${barWidth(flat)}px"></span>`;
  if (ITEM_STYLE === "bar") return bar;
  return `${bar}<span class="claude-prompt-jump-text">${escapeHtml(clip(flat, LABEL_CHARS))}</span>`;
}

/**
 * このタブに目次の帯を張るか。タブ変数だけを見る軽い判定にする
 * （タブ変数・cwdが変わるたびに評価されるため）
 */
export function claudePromptShow(ctx: HoverButtonContext): boolean {
  return ctx.vars.agent === "claude-code" && Boolean(ctx.vars.agent_transcript);
}

/** 目次の項目。1プロンプト＝1行で、棒の長さがそのプロンプトの長さを表す */
export async function claudePromptItems(
  ctx: HoverButtonContext,
  niwa: Niwa,
): Promise<HoverButtonItem[]> {
  const prompts: ClaudePrompt[] = JSON.parse(
    await runCli(niwa, `claude prompt list --json --tab ${ctx.tabId}`),
  );
  return prompts.map((prompt) => ({
    label: `${prompt.index}. ${clip(oneLine(prompt.text), LABEL_CHARS)}`,
    html: itemHtml(prompt),
    tooltip: `${prompt.index}. ${clip(oneLine(prompt.text), TOOLTIP_CHARS)}`,
    // transcriptのuuidはmodから見たプロンプト行のrequestIdと同じ値なので、そのまま渡せる
    run: () => {
      niwa.tab.var.set(ctx.tabId, JUMP_VAR, prompt.uuid);
      niwa.tab.sendKeys(ctx.tabId, JUMP_KEY);
    },
  }));
}

/** itemsのhtmlから参照するCSS。class名にidを含めてniwaterm本体と衝突させない */
export const claudePromptCss = `
.claude-prompt-jump-bar {
  flex: none;
  height: 2px;
  border-radius: 1px;
  background: currentColor;
  opacity: 0.5;
}
.claude-prompt-jump-text {
  margin-left: 6px;
  max-width: 24ch;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.8;
}
`;
