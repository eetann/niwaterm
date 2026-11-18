import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DocTopic,
  formatSearchLines,
  formatTopicLines,
  formatTopicsJson,
  loadTopics,
  parseFrontmatterDescription,
  searchTopicText,
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

describe("searchTopicText", () => {
  const topic = { name: "cli", description: "CLIの使い方" };
  const text = [
    "---",
    "title: CLI",
    "description: CLIの使い方",
    "---",
    "",
    "冒頭の説明 Send-Keys",
    "## タブ操作",
    "```sh",
    "# send-keysの例",
    "niwa tab send-keys --tab tab-3 Enter",
    "```",
    "captureでも取れる",
  ].join("\n");

  test("大文字小文字を区別せず、本文のキーワードを含む行を見出し付きで返す", () => {
    const result = searchTopicText(topic, text, ["SEND-KEYS"]);
    expect(result?.matches).toEqual([
      { line: 6, heading: "", text: "冒頭の説明 Send-Keys", isHeading: false },
      { line: 9, heading: "タブ操作", text: "# send-keysの例", isHeading: false },
      {
        line: 10,
        heading: "タブ操作",
        text: "niwa tab send-keys --tab tab-3 Enter",
        isHeading: false,
      },
    ]);
    expect(result?.hits).toBe(3);
  });

  test("複数キーワードは別々の行にあってもよいが、1つでも無ければ結果に出ない", () => {
    expect(searchTopicText(topic, text, ["send-keys", "capture"])?.hits).toBe(4);
    expect(searchTopicText(topic, text, ["send-keys", "popup"])).toBeNull();
  });

  test("frontmatterの語だけでもページは結果に出るが、frontmatterの行は返さない", () => {
    const result = searchTopicText(topic, text, ["使い方"]);
    expect(result?.matches).toEqual([]);
  });
});

describe("formatSearchLines", () => {
  test("見出しが変わるところで区切り、多すぎる行は件数だけ出す", () => {
    const matches = Array.from({ length: 7 }, (_, i) => ({
      line: i + 10,
      heading: i === 0 ? "" : "節",
      text: `行${i}`,
      isHeading: false,
    }));
    const lines = formatSearchLines([{ name: "cli", description: "説明", hits: 7, matches }]);
    expect(lines).toEqual([
      "cli\t説明",
      "    10: 行0",
      "  ## 節",
      "    11: 行1",
      "    12: 行2",
      "    13: 行3",
      "    14: 行4",
      "    （ほか2行）",
    ]);
  });
});
