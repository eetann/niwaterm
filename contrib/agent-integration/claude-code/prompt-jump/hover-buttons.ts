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

/** 項目の見た目。"text"は印に本文の頭を添える、"mark"は印だけにする */
const ITEM_STYLE: "text" | "mark" = "text";

/** "text"のときに項目へ出す本文の文字数 */
const LABEL_CHARS = 20;

/** 目次の項目に出すツールチップの文字数。長いプロンプトはここで切る */
const TOOLTIP_CHARS = 140;

/**
 * 印の段階を分ける境目となるプロンプトの文字数。GitHubの草と同じで、量そのものではなく
 * 「どのくらいの段階か」だけを見せる
 */
const LENGTH_STEPS = [5, 15, 35, 80];

/**
 * 段階ごとの印の高さ(px)と濃さ。どちらもLENGTH_STEPSより1つ多い。
 * 濃さだけだと段階を見分けにくいので、高さも一緒に変える（幅は変えない。
 * 変えると本文の開始位置が揃わなくなる）
 */
const LEVEL_HEIGHT_PX = [3, 6, 9, 12, 14];
const LEVEL_OPACITY = [0.4, 0.55, 0.7, 0.85, 1];

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

/** プロンプトの長さが何段階目か */
function lengthLevel(text: string): number {
  return LENGTH_STEPS.filter((step) => [...text].length >= step).length;
}

function itemHtml(prompt: ClaudePrompt): string {
  const flat = oneLine(prompt.text);
  const level = lengthLevel(flat);
  const style = `height: ${LEVEL_HEIGHT_PX[level] ?? 14}px; opacity: ${LEVEL_OPACITY[level] ?? 1}`;
  const mark = `<span class="claude-prompt-jump-mark" style="${style}"></span>`;
  if (ITEM_STYLE === "mark") return mark;
  return `${mark}<span class="claude-prompt-jump-text">${escapeHtml(clip(flat, LABEL_CHARS))}</span>`;
}

/**
 * このタブに目次の帯を張るか。タブ変数だけを見る軽い判定にする
 * （タブ変数・cwdが変わるたびに評価されるため）
 */
export function claudePromptShow(ctx: HoverButtonContext): boolean {
  return ctx.vars.agent === "claude-code" && Boolean(ctx.vars.agent_transcript);
}

/** 目次の項目。1プロンプト＝1行で、印の大きさと濃さがそのプロンプトの長さを表す */
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
.claude-prompt-jump-mark {
  flex: none;
  width: 10px;
  border-radius: 2px;
  background: currentColor;
}
.claude-prompt-jump-text {
  margin-left: 6px;
  max-width: 24ch;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.8;
}
`;
