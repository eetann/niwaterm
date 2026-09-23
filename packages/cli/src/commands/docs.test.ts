import { describe, expect, test } from "bun:test";
import {
  type DocTopic,
  formatTopicLines,
  formatTopicsJson,
  loadTopics,
  parseFrontmatterDescription,
} from "./docs";

const TOPICS: DocTopic[] = [
  { name: "cli", description: "CLIの使い方", path: "/docs/guide/cli.md" },
  { name: "worktree", description: "ワークツリー管理", path: "/docs/guide/worktree.md" },
];

describe("parseFrontmatterDescription", () => {
  test("frontmatterのdescriptionを取り出す", () => {
    const text = [
      "---",
      "type: Reference",
      "title: CLIからの操作",
      "description: CLIの使い方",
      "---",
      "",
      "# 本文",
    ].join("\n");
    expect(parseFrontmatterDescription(text)).toBe("CLIの使い方");
  });

  test("frontmatterが無ければnull", () => {
    expect(parseFrontmatterDescription("# 見出しだけ\n")).toBeNull();
  });

  test("descriptionを持たないfrontmatterはnull", () => {
    expect(parseFrontmatterDescription("---\ntitle: タイトル\n---\n")).toBeNull();
  });

  test("本文側のdescription行は拾わない", () => {
    const text = ["---", "title: タイトル", "---", "", "description: これは本文"].join("\n");
    expect(parseFrontmatterDescription(text)).toBeNull();
  });
});

describe("formatTopicLines", () => {
  test("name<TAB>descriptionで1行ずつ出す", () => {
    expect(formatTopicLines(TOPICS)).toEqual(["cli\tCLIの使い方", "worktree\tワークツリー管理"]);
  });
});

describe("formatTopicsJson", () => {
  test("topicsと次の操作を示すhelpを持つ", () => {
    const parsed = JSON.parse(formatTopicsJson(TOPICS));
    expect(parsed.topics).toEqual([
      { name: "cli", description: "CLIの使い方" },
      { name: "worktree", description: "ワークツリー管理" },
    ]);
    expect(parsed.help).toContain("docs show <name>");
  });

  test("パス情報は出さない", () => {
    expect(formatTopicsJson(TOPICS)).not.toContain("/docs/guide/");
  });
});

describe("loadTopics", () => {
  test("docs/guide/のMarkdownをファイル名昇順で列挙し、descriptionを埋める", async () => {
    const topics = await loadTopics();
    expect(topics.map((t) => t.name)).toEqual(["cli", "config", "worktree"]);
    for (const topic of topics) {
      expect(topic.description).not.toBe("");
    }
  });
});
