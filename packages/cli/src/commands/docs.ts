import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { define } from "gunshi";
import { cliName } from "../agent-hint";
import { failAndExit } from "../cli-error";

/** docs/guide/配下のMarkdown1件分。nameは拡張子を除いたファイル名 */
export interface DocTopic {
  name: string;
  description: string;
  path: string;
}

const GUIDE_DIR = join(import.meta.dir, "../../../../docs/guide");

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
 * docs/guide/を走査してトピックを組み立てる。
 * 一覧をハードコードせずファイルから引くことで、guideを増やしたときの載せ忘れと
 * descriptionの二重管理を防ぐ
 */
export async function loadTopics(): Promise<DocTopic[]> {
  const files = (await readdir(GUIDE_DIR)).filter((file) => file.endsWith(".md")).sort();
  const topics: DocTopic[] = [];
  for (const file of files) {
    const path = join(GUIDE_DIR, file);
    const description = parseFrontmatterDescription(await Bun.file(path).text());
    topics.push({ name: basename(file, ".md"), description: description ?? "", path });
  }
  return topics;
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
