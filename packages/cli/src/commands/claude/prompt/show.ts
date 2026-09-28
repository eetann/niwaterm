import { define } from "gunshi";
import {
  DEFAULT_MAX_RESULT_CHARS,
  findPrompt,
  listPrompts,
  promptTurn,
  type TurnBlock,
} from "../../../claude-transcript";
import { failAndExit } from "../../../cli-error";
import { loadTranscript } from "../resolve-transcript";

/** ブロックの種類が一目で分かる行頭記号。Claude Code自身の画面表示に寄せている */
function blockLines(block: TurnBlock): string[] {
  switch (block.kind) {
    case "prompt":
      return [`❯ ${block.text}`];
    case "assistant":
      return [block.text];
    case "thinking":
      return [`✻ ${block.text}`];
    case "tool":
      return [`⏺ ${block.name}${block.input ? `: ${block.input}` : ""}`];
    case "tool-result":
      return [`  ⎿ ${block.text}${block.truncated ? "\n  … (以降は省略)" : ""}`];
  }
}

export default define({
  name: "show",
  description: "Claude Codeのtranscriptから、指定したプロンプトのやりとりを表示する",
  args: {
    prompt: {
      type: "string",
      short: "p",
      description:
        "表示するプロンプト。claude prompt listのindexかuuid（前方一致可）。省略時は最後のプロンプト",
    },
    tab: {
      type: "string",
      short: "t",
      description:
        "対象のtabId（niwaterm listで確認）。省略時はこのコマンドを実行しているタブ（niwatermの外から実行した場合はフォーカス中タイルのアクティブタブ）",
    },
    transcript: {
      type: "string",
      description: "transcript（jsonl）のパス。省略時は対象タブのagent_transcript変数を使う",
    },
    json: {
      type: "boolean",
      description: "JSON形式で出力する（AIエージェント・customView等からのパース用）",
    },
    "max-result": {
      type: "number",
      description: `ツール結果1件あたりの打ち切り文字数（既定: ${DEFAULT_MAX_RESULT_CHARS}）`,
    },
    sidechain: {
      type: "boolean",
      description: "サブエージェント（Taskツール）内部のやりとりも含める",
    },
  },
  run: async (ctx) => {
    const rows = await loadTranscript("claude prompt show", {
      tab: ctx.values.tab,
      transcript: ctx.values.transcript,
    });
    const prompts = listPrompts(rows);
    if (prompts.length === 0) {
      failAndExit("claude prompt showに失敗しました: transcriptにプロンプトがありません");
    }
    const key = ctx.values.prompt ?? String(prompts.length);
    const prompt = findPrompt(prompts, key);
    if (!prompt) {
      failAndExit(
        `claude prompt showに失敗しました: プロンプトが見つかりません: ${key}（1〜${prompts.length}のindexかuuidを指定してください）`,
      );
    }
    const blocks = promptTurn(rows, prompt, {
      maxResultChars: ctx.values["max-result"],
      includeSidechain: ctx.values.sidechain,
    });
    if (ctx.values.json) {
      // console.log・Bun.writeはどちらもパイプ相手だと壊れる（docs/known-issues/
      // bun-cli-stdout-breaks-over-pipe-for-large-output.md）。ここはcustomViewが
      // niwa.shell.run（パイプ）で受けるため、書き方を変えてはいけない
      process.stdout.write(`${JSON.stringify({ prompt, blocks })}\n`);
      return;
    }
    for (const block of blocks) {
      for (const line of blockLines(block)) console.log(line);
      console.log("");
    }
  },
});
