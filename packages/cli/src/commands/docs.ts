import { join } from "node:path";
import { define } from "gunshi";

interface DocTopic {
  name: string;
  description: string;
  relativePath: string;
}

// 現状はcli一本のみだが、将来トピックが増える場合に備えて配列にしておく
const DOC_TOPICS: readonly DocTopic[] = [
  {
    name: "cli",
    description: "niwatermをCLIから操作する方法（コマンド一覧・使用例・IPCサーバー仕様）",
    relativePath: "../../../../docs/cli.md",
  },
];

const listCommand = define({
  name: "list",
  description: "利用可能なドキュメントトピックの一覧を表示",
  rendering: { header: null },
  run: () => {
    for (const topic of DOC_TOPICS) {
      console.log(`${topic.name}\t${topic.description}`);
    }
    console.log('\n"niwaterm docs show <name>" で内容を表示できます。');
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
    const topic = DOC_TOPICS.find((t) => t.name === ctx.values.name);
    if (!topic) {
      console.error(
        `不明なトピックです: ${ctx.values.name}（利用可能: ${DOC_TOPICS.map((t) => t.name).join(", ")}）`,
      );
      process.exit(1);
    }
    const path = join(import.meta.dir, topic.relativePath);
    const file = Bun.file(path);
    if (!(await file.exists())) {
      console.error(`ドキュメントファイルが見つかりません: ${path}`);
      process.exit(1);
    }
    process.stdout.write(await file.text());
  },
});

export default define({
  name: "docs",
  description: "niwaterm CLIのドキュメントを表示する",
  subCommands: { list: listCommand, show: showCommand },
  run: () => {
    console.log('Run "niwaterm docs list" to see available topics.');
  },
});
