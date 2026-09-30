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

export default define({
  name: "docs",
  description: "niwaterm CLIのドキュメントを表示する",
  subCommands: { list: listCommand, show: showCommand },
  run: () => {
    console.log(`"${cliName()} docs list" でトピック一覧を表示できます。`);
  },
});
