// Claude Codeのプロンプト目次（hoverButtons）と会話ビューア（customView）を組で提供する。
// Claude Codeはalternate screenで動くため画面をスクロールしても過去のやりとりは出てこない
// （docs/known-issues/claude-code-history-not-in-scrollback.md）。
// 代わりにniwaterm CLIでtranscript（jsonl）を読み、そこから目次と本文を組み立てる。
//
// 目次の選択はモジュール変数で持つ。hoverButtonsのitemsもcustomViewのhandlersも
// 設定ファイルと同じbunプロセスで動くので、この変数を通して受け渡せる。

import type {
  CustomViewHandlers,
  HoverButtonContext,
  HoverButtonItem,
  Niwa,
} from "@niwaterm/config";

/** PATHにあるniwaterm CLIのコマンド名。devビルドで試すなら"niwaterm-dev"に変える */
const CLI = "niwaterm";

/** customViewsへ登録するときのid。目次から開くときにこの名前で切り替える */
const VIEW_ID = "claude-prompts";

/** 目次の項目に出すツールチップの文字数。長いプロンプトはここで切る */
const TOOLTIP_CHARS = 140;

export interface ClaudePrompt {
  index: number;
  uuid: string;
  source: string;
  timestamp: string;
  text: string;
}

export type ClaudeTurnBlock =
  | { kind: "prompt"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string; input: string }
  | { kind: "tool-result"; text: string; truncated: boolean };

/** 目次から選ばれたプロンプト。customView側のloadがこれを読む */
let selected: { tabId: string; index: number } | null = null;

/**
 * OSCシーケンス（ESC ] ... BEL / ESC \）を取り除く。shell.runはログイン・インタラクティブシェル
 * 経由でコマンドを実行するため、シェル統合を入れているとプロンプトフックが出すOSC 7（cwd通知）が
 * 標準出力へ紛れ込み、そのままだとJSONのパースに失敗する
 */
function stripOsc(text: string): string {
  // biome-ignore-start
  return text.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "");
  // biome-ignore-end
}

async function runCli(niwa: Niwa, args: string): Promise<string> {
  const result = await niwa.shell.run(`${CLI} ${args}`);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${args} に失敗しました`);
  }
  return stripOsc(result.stdout).trim();
}

async function fetchPrompts(niwa: Niwa, tabId: string): Promise<ClaudePrompt[]> {
  return JSON.parse(await runCli(niwa, `claude prompt list --json --tab ${tabId}`));
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
  const prompts = await fetchPrompts(niwa, ctx.tabId);
  return prompts.map((prompt) => ({
    label: String(prompt.index),
    html: '<span class="claude-prompts-tick"></span>',
    tooltip: tooltip(prompt),
    run: async () => {
      selected = { tabId: ctx.tabId, index: prompt.index };
      await runCli(niwa, `sidebar switch --view ${VIEW_ID}`);
    },
  }));
}

/** itemsのhtmlから参照するCSS。class名にidを含めてniwaterm本体と衝突させない */
export const claudePromptCss = `
.claude-prompts-tick {
  display: block;
  width: 14px;
  height: 2px;
  border-radius: 1px;
  background: currentColor;
  opacity: 0.45;
}
.claude-prompts-tick:hover {
  opacity: 1;
}
`;

/** HTML側の niwaterm.call から呼ばれるハンドラ */
export const claudePromptHandlers: CustomViewHandlers = {
  /**
   * 目次と、選ばれているプロンプトのやりとりを返す。
   * payload.indexを渡せばそのプロンプトへ移る（ビューア内の前後移動・目次クリック用）
   */
  load: async (payload: { index?: number } | undefined, niwa: Niwa) => {
    if (!selected) {
      return { ready: false, message: "目次からプロンプトを選ぶと、ここにやりとりが出ます" };
    }
    const { tabId } = selected;
    if (typeof payload?.index === "number") selected = { tabId, index: payload.index };
    const prompts = await fetchPrompts(niwa, tabId);
    if (prompts.length === 0) {
      return { ready: false, message: "このタブのtranscriptにプロンプトがありません" };
    }
    // 選んだ後にプロンプトが減ることは無いが、別セッションへ切り替わった場合に備えて丸める
    const index = Math.min(Math.max(selected.index, 1), prompts.length);
    selected = { tabId, index };
    const shown = JSON.parse(
      await runCli(niwa, `claude prompt show --json --tab ${tabId} --prompt ${index}`),
    ) as { prompt: ClaudePrompt; blocks: ClaudeTurnBlock[] };
    return { ready: true, tabId, index, prompts, blocks: shown.blocks };
  },
};
