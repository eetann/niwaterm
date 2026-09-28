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
  message?: { role?: string; content?: unknown };
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

/**
 * プロンプトの境界となる行か。サブエージェント（isSidechain）の内部やりとりは
 * 本人のプロンプトではないので境界に数えない
 */
function isPromptBoundary(row: TranscriptRow): boolean {
  return row.type === "user" && typeof row.promptSource === "string" && !row.isSidechain;
}

function isUserPrompt(row: TranscriptRow): boolean {
  return isPromptBoundary(row) && row.promptSource !== SYSTEM_PROMPT_SOURCE;
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
  const prompts: TranscriptPrompt[] = [];
  for (const row of rows) {
    if (!isUserPrompt(row)) continue;
    const text = contentText(row.message?.content);
    if (!text.trim()) continue;
    prompts.push({
      index: prompts.length + 1,
      uuid: typeof row.uuid === "string" ? row.uuid : "",
      source: String(row.promptSource),
      timestamp: typeof row.timestamp === "string" ? row.timestamp : "",
      text,
    });
  }
  return prompts;
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
    if (isUserPrompt(row)) return [{ kind: "prompt", text: contentText(content) }];
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
