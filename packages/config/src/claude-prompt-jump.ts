// Claude Codeのタブの端にプロンプトの目次を出し、選んだプロンプトへClaude Codeの表示を飛ばす
// ホバーボタン。Claude Code側のmod（contrib/agent-integration/claude-code/prompt-jump/mod）と対で動く。
//
// 画面を動かせるのはClaude Code自身だけで、niwaterm側から位置を触る余地は無い
// （alternate screenで動くためスクロールバックに会話が1行も残らない。詳細は
// docs/known-issues/claude-code-history-not-in-scrollback.md）。そのため、ここでは
// ジャンプ先のuuidをタブ変数へ置き、modのButtonを押すキーを送るところまでを担う。
//
// ユーザー設定から`@niwaterm/config`経由で読ませるのは、設定ディレクトリへファイルを写す方式だと
// 本体を更新しても写した側が古いまま残るため。

import type { HoverButtonConfig, HoverButtonContext, HoverButtonItem } from "./hover-button";
import type { Niwa } from "./niwa";

export interface ClaudePromptJumpOptions extends Omit<HoverButtonConfig, "items"> {
  /** PATHにあるniwaterm CLIのコマンド名。devビルドで試すなら"niwa-dev" */
  cli?: string;
  /**
   * modがプロンプト上の帯へ置いたButtonを押すキー。既定はClaude Codeの`app:openArtifact`に
   * 割り当てられたキー（ctrl+]）で、mod側の`action`を変えたらこちらも揃える
   */
  jumpKey?: string;
  /** 項目の見た目。"text"は印に本文の頭を添える、"mark"は印だけにする */
  itemStyle?: "text" | "mark";
  /** itemStyleが"text"のときに項目へ出す本文の文字数 */
  labelChars?: number;
  /** 項目に出すツールチップの文字数。長いプロンプトはここで切る */
  tooltipChars?: number;
  /**
   * 目次の末尾の「最新へ」で送るキー。既定はClaude Codeの`scroll:bottom`に割り当てられたキー
   * （ctrl+end）。falseなら「最新へ」を出さない
   */
  latestKey?: string | false;
  /** Claudeが投げた質問（AskUserQuestion）も、そのプロンプトの下へ並べる */
  questions?: boolean;
}

/** ジャンプ先のプロンプトのuuidを渡すタブ変数。modが`niwa tab var get`で読む */
const JUMP_VAR = "agent_jump";

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

/**
 * 印・本文のスタイル。class名に機能名を含めてniwaterm本体と衝突させない。
 * パネルは上下の辺・四隅に置くと横並びになるが、目次は置き場所によらず縦に並べたいので、
 * 印を含むパネルだけ縦並びに固定する。
 * 「最新へ」はプロンプトが多いとスクロールの奥に隠れるので、パネルの下端に貼り付けておく
 */
const CSS = `
.hover-panel:has(.claude-prompt-jump-mark) {
  flex-direction: column;
}
.claude-prompt-jump-mark {
  flex: none;
  width: 10px;
  border-radius: 2px;
  background: currentColor;
}
.hover-item:has(.claude-prompt-jump-latest) {
  position: sticky;
  bottom: 0;
  background: var(--chrome-bg);
}
.claude-prompt-jump-latest {
  opacity: 0.8;
}
.claude-prompt-jump-question {
  flex: none;
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border: 2px solid currentColor;
  border-radius: 50%;
  opacity: 0.7;
}
.claude-prompt-jump-text {
  margin-left: 6px;
  max-width: 24ch;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.8;
}
`;

interface ClaudeQuestion {
  toolUseId: string;
  items: { header: string; question: string; answer?: string }[];
}

interface ClaudePrompt {
  index: number;
  uuid: string;
  text: string;
  /** 古いCLIは持たない */
  questions?: ClaudeQuestion[];
}

/**
 * OSCシーケンス（ESC ] ... BEL / ESC \）を取り除く。shell.runはログイン・インタラクティブシェル
 * 経由でコマンドを実行するため、シェル統合を入れているとプロンプトフックが出すOSC 7（cwd通知）が
 * 標準出力へ紛れ込み、そのままだとJSONのパースに失敗する
 */
function stripOsc(text: string): string {
  // oxlint-disable-next-line no-control-regex -- ESC・BELを拾うのが目的
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

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, chars: number): string {
  const glyphs = [...text];
  return glyphs.length > chars ? `${glyphs.slice(0, chars).join("")}…` : text;
}

/** 質問の短い見出し。headerは選択肢の上に出るチップの文言で、無ければ質問文で代える */
function questionLabel(question: ClaudeQuestion): string {
  return question.items.map((item) => oneLine(item.header || item.question)).join(" / ");
}

function questionTooltip(question: ClaudeQuestion): string {
  return question.items
    .map((item) => oneLine(item.answer ? `${item.question} → ${item.answer}` : item.question))
    .join(" / ");
}

/** プロンプトの長さが何段階目か */
function lengthLevel(text: string): number {
  return LENGTH_STEPS.filter((step) => [...text].length >= step).length;
}

/**
 * このタブに目次を出すか。タブ変数だけを見る軽い判定にする
 * （タブ変数・cwdが変わるたびに評価されるため）
 */
function isClaudeTab(ctx: HoverButtonContext): boolean {
  return ctx.vars["agent"] === "claude-code" && Boolean(ctx.vars["agent_transcript"]);
}

/**
 * プロンプトの目次のホバーボタンを作る。`hoverButtons`へそのまま並べられる。
 * 1プロンプト＝1行で、印の大きさと濃さがそのプロンプトの長さを表す。
 * position・handle等はHoverButtonConfigと同じ意味で上書きでき、cssは既定のスタイルの後ろへ足される
 */
export function claudePromptJump(options: ClaudePromptJumpOptions = {}): HoverButtonConfig {
  const {
    cli = "niwa",
    jumpKey = "C-]",
    itemStyle = "text",
    labelChars = 20,
    tooltipChars = 140,
    latestKey = "C-End",
    questions = true,
    css,
    ...button
  } = options;

  async function runCli(niwa: Niwa, args: string): Promise<string> {
    const result = await niwa.shell.run(`${cli} ${args}`);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `${args} に失敗しました`);
    }
    return stripOsc(result.stdout).trim();
  }

  function itemHtml(prompt: ClaudePrompt): string {
    const flat = oneLine(prompt.text);
    const level = lengthLevel(flat);
    const style = `height: ${LEVEL_HEIGHT_PX[level] ?? 14}px; opacity: ${LEVEL_OPACITY[level] ?? 1}`;
    const mark = `<span class="claude-prompt-jump-mark" style="${style}"></span>`;
    if (itemStyle === "mark") return mark;
    return `${mark}<span class="claude-prompt-jump-text">${escapeHtml(clip(flat, labelChars))}</span>`;
  }

  function questionHtml(question: ClaudeQuestion): string {
    const mark = `<span class="claude-prompt-jump-question"></span>`;
    if (itemStyle === "mark") return mark;
    return `${mark}<span class="claude-prompt-jump-text">${escapeHtml(clip(questionLabel(question), labelChars))}</span>`;
  }

  /** ジャンプ先をタブ変数へ置いてmodのButtonを押す。プロンプトも質問も同じ経路で飛べる */
  function jump(niwa: Niwa, tabId: string, requestId: string): void {
    niwa.tab.var.set(tabId, JUMP_VAR, requestId);
    niwa.tab.sendKeys(tabId, jumpKey);
  }

  function promptItems(prompt: ClaudePrompt, tabId: string, niwa: Niwa): HoverButtonItem[] {
    const items: HoverButtonItem[] = [
      {
        label: `${prompt.index}. ${clip(oneLine(prompt.text), labelChars)}`,
        html: itemHtml(prompt),
        tooltip: `${prompt.index}. ${clip(oneLine(prompt.text), tooltipChars)}`,
        // transcriptのuuidはmodから見たプロンプト行のrequestIdと同じ値なので、そのまま渡せる
        run: () => jump(niwa, tabId, prompt.uuid),
      },
    ];
    if (!questions) return items;
    for (const question of prompt.questions ?? []) {
      items.push({
        label: `? ${clip(questionLabel(question), labelChars)}`,
        html: questionHtml(question),
        tooltip: clip(questionTooltip(question), tooltipChars),
        // tool_useのidはmodから見たツール行のrequestIdと同じ値
        run: () => jump(niwa, tabId, question.toolUseId),
      });
    }
    return items;
  }

  return {
    id: "claude-prompt-jump",
    show: isClaudeTab,
    ...button,
    css: css ? `${CSS}\n${css}` : CSS,
    items: async (ctx, niwa): Promise<HoverButtonItem[]> => {
      const prompts: ClaudePrompt[] = JSON.parse(
        await runCli(niwa, `claude prompt list --json --tab ${ctx.tabId}`),
      );
      const items = prompts.flatMap((prompt) => promptItems(prompt, ctx.tabId, niwa));
      if (latestKey === false || items.length === 0) return items;
      // 一番下へ移すだけなのでmodを通さず、Claude Code自身のキー操作に任せる
      items.push({
        label: "最新へ",
        html: `<span class="claude-prompt-jump-latest">${itemStyle === "mark" ? "↓" : "↓ 最新へ"}</span>`,
        tooltip: "最新へ",
        run: () => niwa.tab.sendKeys(ctx.tabId, latestKey),
      });
      return items;
    },
  };
}
