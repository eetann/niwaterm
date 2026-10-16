// Claude Codeのtranscript（jsonl）から、ユーザーが打ったプロンプトとそのターンを切り出す。
// Claude Codeはalternate screenで動くためniwaterm側のスクロールバックに履歴が残らず、
// 過去のやりとりを辿れるのはこのファイルだけ（docs/known-issues/claude-code-history-not-in-scrollback.md）。

/** jsonlの1行。スキーマはClaude Code側の実装都合で増減するため、読む項目だけを緩く持つ */
export interface TranscriptRow {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  /** ユーザー入力の由来。この項目を持つ行がプロンプトの境界になる */
  promptSource?: string;
  /**
   * 行の発生源。スラッシュコマンドで呼んだスキルの行はpromptSourceを持たず、
   * こちらの`kind: "human"`だけで人の入力だと分かる
   */
  origin?: { kind?: string };
  message?: { role?: string; content?: unknown };
  /** tool_resultの行に付く、ツールが返した構造化済みの結果 */
  toolUseResult?: unknown;
  [key: string]: unknown;
}

/**
 * 目次に並べる1プロンプト。indexは1始まりの通し番号で、`--prompt`へuuidの代わりに
 * 短く渡せるようにしている
 */
export interface TranscriptPrompt {
  index: number;
  uuid: string;
  /** typed / queued / suggestion_accepted など */
  source: string;
  timestamp: string;
  text: string;
  /** このプロンプトから次のプロンプトまでの間にClaudeが投げた質問（AskUserQuestion） */
  questions: TranscriptQuestion[];
}

/**
 * AskUserQuestionの1回の呼び出し。1回で複数の質問をまとめて出せるので、
 * ジャンプ先（toolUseId）は呼び出し単位で1つになる
 */
export interface TranscriptQuestion {
  /** Claude Code上でのその行のrequestIdと同じ値 */
  toolUseId: string;
  items: { header: string; question: string; answer?: string }[];
}

/** ターンの中身を表示用に平らにしたもの。整形は呼び出し側（customViewのHTML等）に委ねる */
export type TurnBlock =
  | { kind: "prompt"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string; input: string }
  | { kind: "tool-result"; text: string; truncated: boolean };

/**
 * システムが差し込んだプロンプト（task-notification等）の由来。ターンの境界にはなるが、
 * ユーザーが打ったものではないので目次には並べない
 */
const SYSTEM_PROMPT_SOURCE = "system";

/** tool_resultの既定の打ち切り文字数。1件で数万文字になることがあり、そのまま渡すと表示側が潰れる */
export const DEFAULT_MAX_RESULT_CHARS = 2000;

/** 壊れた行は黙って捨てる。書き込み途中の最終行が読めないことがあるため */
export function parseJsonl(text: string): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as unknown;
      if (row !== null && typeof row === "object" && !Array.isArray(row)) {
        rows.push(row as TranscriptRow);
      }
    } catch {}
  }
  return rows;
}

/** promptSourceの無い行のうち、人の入力として扱うoriginの種類 */
const HUMAN_ORIGIN_KIND = "human";

/** 目次でスラッシュコマンドから呼んだ行を見分けるためのsource */
const COMMAND_PROMPT_SOURCE = "command";

const QUESTION_TOOL = "AskUserQuestion";

/**
 * プロンプトの境界となる行か。サブエージェント（isSidechain）の内部やりとりは
 * 本人のプロンプトではないので境界に数えない。
 * /clear・/compactのようなローカルコマンドの行はどちらの項目も持たず、
 * Claudeの応答も始まらないので境界にしない
 */
function isPromptBoundary(row: TranscriptRow): boolean {
  if (row.type !== "user" || row.isSidechain || row.isMeta) return false;
  return typeof row.promptSource === "string" || typeof row.origin?.kind === "string";
}

function isUserPrompt(row: TranscriptRow): boolean {
  if (!isPromptBoundary(row)) return false;
  if (typeof row.promptSource === "string") return row.promptSource !== SYSTEM_PROMPT_SOURCE;
  return row.origin?.kind === HUMAN_ORIGIN_KIND;
}

/**
 * スラッシュコマンドの行は`<command-name>/foo</command-name><command-args>…</command-args>`の
 * タグ付きで記録されるので、打ったときの`/foo …`の形へ戻す。コマンドでなければnull
 */
function commandPromptText(text: string): string | null {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim();
  if (!name) return null;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? "";
  return args ? `${name} ${args}` : name;
}

function promptText(row: TranscriptRow): string {
  const text = contentText(row.message?.content);
  return commandPromptText(text) ?? text;
}

/** contentが文字列でも配列でも、表示に使えるテキストを1本にまとめる */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (part === null || typeof part !== "object") continue;
    const block = part as { type?: string; text?: unknown };
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

/** 目次の1行に出す短いラベル。改行・連続空白を畳んで1行にする */
export function promptLabel(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return [...flat].length > maxChars ? `${[...flat].slice(0, maxChars).join("")}…` : flat;
}

/**
 * ユーザーが打ったプロンプトを、**ファイルの行順**で並べる。timestampは順序の根拠に使えない
 * （同一セッションでも前後する行が実在する）ため、追記された順をそのまま使う
 */
export function listPrompts(rows: TranscriptRow[]): TranscriptPrompt[] {
  const answers = questionAnswers(rows);
  const prompts: TranscriptPrompt[] = [];
  for (const row of rows) {
    if (row.isSidechain) continue;
    if (isUserPrompt(row)) {
      const raw = contentText(row.message?.content);
      const command = commandPromptText(raw);
      const text = command ?? raw;
      if (!text.trim()) continue;
      prompts.push({
        index: prompts.length + 1,
        uuid: typeof row.uuid === "string" ? row.uuid : "",
        source:
          row.promptSource ?? (command !== null ? COMMAND_PROMPT_SOURCE : String(row.origin?.kind)),
        timestamp: typeof row.timestamp === "string" ? row.timestamp : "",
        text,
        questions: [],
      });
      continue;
    }
    // task-notification等のターン中に来た質問も、直前に打ったプロンプトの下へ並べる。
    // 目次はファイルの行順に並ぶので、どこへ付けても前後関係は崩れない
    const current = prompts.at(-1);
    if (current && row.type === "assistant") current.questions.push(...rowQuestions(row, answers));
  }
  return prompts;
}

/** AskUserQuestionのtool_use_idから、質問文→選んだ答えの対応を引けるようにする */
function questionAnswers(rows: TranscriptRow[]): Map<string, Record<string, string>> {
  const answers = new Map<string, Record<string, string>>();
  for (const row of rows) {
    if (row.type !== "user" || !Array.isArray(row.message?.content)) continue;
    const result = row.toolUseResult as { answers?: unknown } | undefined;
    if (result === null || typeof result !== "object") continue;
    if (result.answers === null || typeof result.answers !== "object") continue;
    for (const part of row.message.content as { type?: string; tool_use_id?: unknown }[]) {
      if (part?.type === "tool_result" && typeof part.tool_use_id === "string") {
        answers.set(part.tool_use_id, result.answers as Record<string, string>);
      }
    }
  }
  return answers;
}

function rowQuestions(
  row: TranscriptRow,
  answers: Map<string, Record<string, string>>,
): TranscriptQuestion[] {
  const content = row.message?.content;
  if (!Array.isArray(content)) return [];
  const questions: TranscriptQuestion[] = [];
  for (const part of content) {
    if (part === null || typeof part !== "object") continue;
    const block = part as { type?: string; id?: unknown; name?: unknown; input?: unknown };
    if (block.type !== "tool_use" || block.name !== QUESTION_TOOL) continue;
    if (typeof block.id !== "string") continue;
    const answered = answers.get(block.id) ?? {};
    const items = questionInputs(block.input).map(({ header, question }) => {
      const answer = answered[question];
      return typeof answer === "string" ? { header, question, answer } : { header, question };
    });
    if (items.length > 0) questions.push({ toolUseId: block.id, items });
  }
  return questions;
}

function questionInputs(input: unknown): { header: string; question: string }[] {
  const questions = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return [];
  const items: { header: string; question: string }[] = [];
  for (const q of questions) {
    if (q === null || typeof q !== "object") continue;
    const { header, question } = q as { header?: unknown; question?: unknown };
    if (typeof question !== "string" || !question.trim()) continue;
    items.push({ header: typeof header === "string" ? header : "", question });
  }
  return items;
}

/** uuid（前方一致でも可）か1始まりの通し番号でプロンプトを引く */
export function findPrompt(prompts: TranscriptPrompt[], key: string): TranscriptPrompt | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return prompts[Number(trimmed) - 1] ?? null;
  return (
    prompts.find((p) => p.uuid === trimmed) ??
    prompts.find((p) => p.uuid.startsWith(trimmed)) ??
    null
  );
}

function toolInput(input: unknown): string {
  if (input === null || typeof input !== "object") return "";
  const questions = questionInputs(input);
  if (questions.length > 0) return questions.map((q) => q.question).join(" / ");
  const values = input as Record<string, unknown>;
  // コマンド・パス・パターンが分かれば何をしたかは読めるので、代表的な項目だけを拾う
  for (const key of ["command", "file_path", "pattern", "url", "description", "prompt"]) {
    const value = values[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  const chars = [...text];
  return chars.length > maxChars
    ? { text: chars.slice(0, maxChars).join(""), truncated: true }
    : { text, truncated: false };
}

/** 1行を0個以上の表示ブロックへ落とす */
function rowBlocks(row: TranscriptRow, maxResultChars: number): TurnBlock[] {
  const content = row.message?.content;
  if (row.type === "user") {
    if (isUserPrompt(row)) return [{ kind: "prompt", text: promptText(row) }];
    // tool_resultはuser roleの配列として入っている
    const blocks: TurnBlock[] = [];
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part === null || typeof part !== "object") continue;
        const block = part as { type?: string; content?: unknown };
        if (block.type !== "tool_result") continue;
        const { text, truncated } = truncate(contentText(block.content), maxResultChars);
        if (text.trim()) blocks.push({ kind: "tool-result", text, truncated });
      }
    }
    return blocks;
  }
  if (row.type !== "assistant" || !Array.isArray(content)) return [];
  const blocks: TurnBlock[] = [];
  for (const part of content) {
    if (part === null || typeof part !== "object") continue;
    const block = part as {
      type?: string;
      text?: unknown;
      thinking?: unknown;
      name?: unknown;
      input?: unknown;
    };
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      blocks.push({ kind: "assistant", text: block.text });
    } else if (
      block.type === "thinking" &&
      typeof block.thinking === "string" &&
      block.thinking.trim()
    ) {
      blocks.push({ kind: "thinking", text: block.thinking });
    } else if (block.type === "tool_use") {
      blocks.push({ kind: "tool", name: String(block.name ?? ""), input: toolInput(block.input) });
    }
  }
  return blocks;
}

export interface PromptTurnOptions {
  /** tool_result 1件あたりの打ち切り文字数 */
  maxResultChars?: number;
  /** サブエージェント（isSidechain）のやりとりも含める */
  includeSidechain?: boolean;
}

/**
 * 指定したプロンプトから次のプロンプト境界までを切り出す。
 * 境界にはシステムが差し込んだプロンプトも含めるので、task-notificationで区切られた
 * 先のやりとりは次のターンとして分かれる
 */
export function promptTurn(
  rows: TranscriptRow[],
  prompt: TranscriptPrompt,
  opts: PromptTurnOptions = {},
): TurnBlock[] {
  const maxResultChars = opts.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
  const start = rows.findIndex((row) => isUserPrompt(row) && row.uuid === prompt.uuid);
  if (start < 0) return [];
  const blocks: TurnBlock[] = [];
  for (let i = start; i < rows.length; i++) {
    const row = rows[i]!;
    if (i > start && isPromptBoundary(row)) break;
    if (row.isMeta) continue;
    if (row.isSidechain && !opts.includeSidechain) continue;
    blocks.push(...rowBlocks(row, maxResultChars));
  }
  return blocks;
}
