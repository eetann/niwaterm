import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DocTopic,
  formatTopicLines,
  formatTopicsJson,
  loadTopics,
  parseFrontmatterDescription,
} from "./docs";

const TOPICS: DocTopic[] = [
  { name: "cli", description: "CLIの使い方", path: "/website/src/content/docs/cli.md" },
  {
    name: "worktree",
    description: "ワークツリー管理",
    path: "/website/src/content/docs/worktrees.md",
  },
];

describe("parseFrontmatterDescription", () => {
  test("frontmatterのdescriptionを取り出す", () => {
    const text = [
      "---",
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
    expect(formatTopicsJson(TOPICS)).not.toContain("/website/");
  });
});

describe("loadTopics", () => {
  test("サイトのcontentディレクトリの.mdをパス昇順で列挙し、descriptionを埋める", async () => {
    const topics = await loadTopics();
    const names = topics.map((t) => t.name);
    // ページは増減するので一覧全体は固定しない。cliはAIエージェントの入口として参照されている
    expect(names).toContain("cli");
    expect(names).toContain("keybindings/api");
    // トップページのindex.mdxはターミナルで読む前提のページではないので含めない
    expect(names).not.toContain("index");
    expect(names).toEqual([...names].sort());
    for (const topic of topics) {
      expect(topic.description).not.toBe("");
    }
  });
});

describe("loadTopics（サブディレクトリ）", () => {
  test("サブディレクトリの.mdは/区切りの相対パスをトピック名にし、.mdxは含めない", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niwaterm-docs-"));
    try {
      await mkdir(join(dir, "config"));
      const page = (description: string) => `---\ntitle: t\ndescription: ${description}\n---\n`;
      await writeFile(join(dir, "cli.md"), page("CLI"));
      await writeFile(join(dir, "config", "keybindings.md"), page("キーバインド"));
      await writeFile(join(dir, "index.mdx"), page("トップ"));
      const topics = await loadTopics(dir);
      expect(topics.map(({ name, description }) => ({ name, description }))).toEqual([
        { name: "cli", description: "CLI" },
        { name: "config/keybindings", description: "キーバインド" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
