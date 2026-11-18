import { readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { define } from "gunshi";
import { cliName } from "../agent-hint";
import { failAndExit } from "../cli-error";

/**
 * ドキュメントサイトのMarkdown1件分。nameはcontentディレクトリからの相対パスから拡張子を除いたもの
 * （サブディレクトリ内なら`keybindings/api`のように`/`区切り）で、サイトのURLのパスに対応する
 */
export interface DocTopic {
  name: string;
  description: string;
  path: string;
}

// ドキュメントサイト（Astro Starlight）のcontentディレクトリ。サイト側の配置規約に依存するので、
// 場所が変わったらここだけ直す（ADR 0008）
const CONTENT_DIR = join(import.meta.dir, "../../../../website/src/content/docs");

function nextStepHint(): string {
  return `"${cliName()} docs show <name>" で内容を表示できます。`;
}

/**
 * OKFのfrontmatterからdescriptionを取り出す。
 * 先頭の---ブロックの中だけを見るので、本文に同じ書式の行があっても拾わない
 */
export function parseFrontmatterDescription(text: string): string | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  for (const line of text.slice(4, end).split("\n")) {
    const match = /^description:\s*(.+)$/.exec(line);
    if (match) return match[1].trim();
  }
  return null;
}

export function formatTopicLines(topics: readonly DocTopic[]): string[] {
  return topics.map((topic) => `${topic.name}\t${topic.description}`);
}

export function formatTopicsJson(topics: readonly DocTopic[]): string {
  return JSON.stringify(
    {
      topics: topics.map(({ name, description }) => ({ name, description })),
      help: nextStepHint(),
    },
    null,
    2,
  );
}

/**
 * サイトのcontentディレクトリをサブディレクトリまで走査してトピックを組み立てる。
 * 一覧をハードコードせずファイルから引くことで、ページを増やしたときの載せ忘れと
 * descriptionの二重管理を防ぐ。`.mdx`はフレームワークのコンポーネントを含み
 * ターミナルでは読みにくいので対象にしない
 */
export async function loadTopics(dir: string = CONTENT_DIR): Promise<DocTopic[]> {
  const files = (await readdir(dir, { recursive: true }))
    .filter((file) => file.endsWith(".md"))
    // Windowsではreaddirがバックスラッシュ区切りのパスを返すので、トピック名はOSによらず`/`へ揃える
    .map((file) => file.split(sep).join("/"));
  const topics: DocTopic[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const description = parseFrontmatterDescription(await Bun.file(path).text());
    topics.push({ name: file.slice(0, -".md".length), description: description ?? "", path });
  }
  // 拡張子付きのまま並べると`-`が`.`より前に来て、`shell-integration`が`shell`より先に並ぶ
  return topics.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** キーワードを含む1行。headingはその行が属する直近の見出し（見出しより前なら空） */
export interface DocMatch {
  line: number;
  heading: string;
  text: string;
  /** この行自体が見出しか（見出しの行は、その見出しの区切りを重ねて出さない） */
  isHeading: boolean;
}

/** 検索で出てきた1ページ。hitsは全キーワードの出現回数の合計で、並べ替えに使う */
export interface DocSearchResult {
  name: string;
  description: string;
  hits: number;
  matches: DocMatch[];
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length))
    count++;
  return count;
}

/** frontmatterの直後の行番号（0始まり）。frontmatterが無ければ0 */
function bodyStartLine(lines: readonly string[]): number {
  if (lines[0] !== "---") return 0;
  const end = lines.indexOf("---", 1);
  return end === -1 ? 0 : end + 1;
}

/**
 * 1ページ分の本文をキーワードで検索する。キーワードは大文字小文字を区別せず、
 * **全キーワードがページのどこか（title・descriptionを含む）に出るページだけ**を返す。
 * 1行に全部が揃うことは求めない（1つの事柄を複数行にまたいで書くことが多いため）。
 * 返す行は、本文のうちどれか1つでもキーワードを含む行
 */
export function searchTopicText(
  topic: Pick<DocTopic, "name" | "description">,
  text: string,
  keywords: readonly string[],
): DocSearchResult | null {
  const needles = keywords.map((k) => k.toLowerCase()).filter((k) => k !== "");
  if (needles.length === 0) return null;
  const counts = needles.map((needle) => countOccurrences(text.toLowerCase(), needle));
  if (counts.some((count) => count === 0)) return null;

  const lines = text.split("\n");
  const matches: DocMatch[] = [];
  let heading = "";
  let inFence = false;
  for (let i = bodyStartLine(lines); i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    // コードブロック内のシェルのコメント（`# ...`）を見出しと取り違えない
    const isHeading = !inFence && /^#{1,6}\s/.test(line);
    if (isHeading) heading = line.replace(/^#+\s*/, "").trim();
    const lowerLine = line.toLowerCase();
    if (needles.some((needle) => lowerLine.includes(needle)))
      matches.push({ line: i + 1, heading, text: line.trim(), isHeading });
  }
  return {
    name: topic.name,
    description: topic.description,
    hits: counts.reduce((sum, count) => sum + count, 0),
    matches,
  };
}

/** 全キーワードを含むページを、出現回数の多い順に並べる（同数ならトピック名順） */
export async function searchTopics(
  topics: readonly DocTopic[],
  keywords: readonly string[],
): Promise<DocSearchResult[]> {
  const results: DocSearchResult[] = [];
  for (const topic of topics) {
    const result = searchTopicText(topic, await Bun.file(topic.path).text(), keywords);
    if (result) results.push(result);
  }
  return results.sort((a, b) => b.hits - a.hits || (a.name < b.name ? -1 : 1));
}

// テキスト出力で1ページあたりに出す行数。多くの行に出てくる語で出力が膨らみ、エージェントの
// コンテキストを食い潰さないよう切る（全行はdocs showで読める。--jsonは切らない）
const MAX_TEXT_MATCHES_PER_TOPIC = 5;

export function formatSearchLines(results: readonly DocSearchResult[]): string[] {
  const out: string[] = [];
  for (const result of results) {
    out.push(`${result.name}\t${result.description}`);
    let lastHeading = "";
    for (const match of result.matches.slice(0, MAX_TEXT_MATCHES_PER_TOPIC)) {
      if (match.heading !== lastHeading && match.heading !== "" && !match.isHeading)
        out.push(`  ## ${match.heading}`);
      lastHeading = match.heading;
      out.push(`    ${match.line}: ${match.text}`);
    }
    const rest = result.matches.length - MAX_TEXT_MATCHES_PER_TOPIC;
    if (rest > 0) out.push(`    （ほか${rest}行）`);
  }
  return out;
}

export function formatSearchJson(
  keywords: readonly string[],
  results: readonly DocSearchResult[],
): string {
  return JSON.stringify({ query: keywords, results, help: nextStepHint() }, null, 2);
}

const listCommand = define({
  name: "list",
  description: "利用可能なドキュメントトピックの一覧を表示",
  rendering: { header: null },
  args: {
    json: {
      type: "boolean",
      description: "JSON形式で出力する（AIエージェント等からのパース用）",
    },
  },
  run: async (ctx) => {
    const topics = await loadTopics();
    if (ctx.values.json) {
      console.log(formatTopicsJson(topics));
      return;
    }
    for (const line of formatTopicLines(topics)) {
      console.log(line);
    }
    console.log(`\n${nextStepHint()}`);
  },
});

const showCommand = define({
  name: "show",
  description: "指定したトピックのドキュメントを表示",
  rendering: { header: null },
  args: {
    name: {
      type: "positional",
      description: "表示するトピック名（例: cli）",
    },
  },
  run: async (ctx) => {
    const topics = await loadTopics();
    const topic = topics.find((t) => t.name === ctx.values.name);
    if (!topic) {
      failAndExit(
        `docs showに失敗しました: 不明なトピックです: ${ctx.values.name}（利用可能: ${topics.map((t) => t.name).join(", ")}）`,
      );
    }
    process.stdout.write(await Bun.file(topic.path).text());
  },
});

const searchCommand = define({
  name: "search",
  description: "ドキュメント全体をキーワードで検索する（複数指定すると全部を含むページだけ）",
  rendering: { header: null },
  args: {
    keywords: {
      type: "positional",
      multiple: true,
      description: "検索するキーワード（大文字小文字は区別しない）",
    },
    json: {
      type: "boolean",
      description: "JSON形式で出力する（キーワードを含む行を省略せずに出す）",
    },
  },
  run: async (ctx) => {
    // `-`で始まる語（`--json`のようなオプション名）は`--`の後ろに置けば探せる
    const keywords = [...(ctx.values.keywords ?? []), ...ctx.rest].filter((k) => k !== "");
    if (keywords.length === 0) {
      failAndExit(
        `docs searchに失敗しました: キーワードを1つ以上指定してください（例: ${cliName()} docs search send-keys）`,
      );
    }
    const results = await searchTopics(await loadTopics(), keywords);
    if (ctx.values.json) {
      console.log(formatSearchJson(keywords, results));
      return;
    }
    if (results.length === 0) {
      console.log(`見つかりませんでした: ${keywords.join(" ")}`);
      console.log(`"${cliName()} docs list" でトピック一覧を確認できます。`);
      // 見つからなかったことをスクリプトから判定できるよう、grepと同じく1で終える
      process.exitCode = 1;
      return;
    }
    for (const line of formatSearchLines(results)) console.log(line);
    console.log(`\n${nextStepHint()}`);
  },
});

export default define({
  name: "docs",
  description: "niwaterm CLIのドキュメントを表示する",
  subCommands: { list: listCommand, show: showCommand, search: searchCommand },
  run: () => {
    console.log(
      `"${cliName()} docs list" でトピック一覧、"${cliName()} docs search <keyword>" で検索できます。`,
    );
  },
});
