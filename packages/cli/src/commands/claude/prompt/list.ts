import { define } from "gunshi";
import { listPrompts, promptLabel } from "../../../claude-transcript";
import { loadTranscript } from "../resolve-transcript";

/** 人間向け表示でラベルを畳む幅。長いプロンプトを1行に収めるための目安 */
const DEFAULT_LABEL_CHARS = 72;

export default define({
  name: "list",
  description: "Claude Codeのtranscriptから、そのセッションで打ったプロンプトを一覧表示する",
  args: {
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
    label: {
      type: "number",
      description: `人間向け表示でラベルを畳む文字数（既定: ${DEFAULT_LABEL_CHARS}）`,
    },
  },
  run: async (ctx) => {
    const rows = await loadTranscript("claude prompt list", {
      tab: ctx.values.tab,
      transcript: ctx.values.transcript,
    });
    const prompts = listPrompts(rows);
    if (ctx.values.json) {
      console.log(JSON.stringify(prompts));
      return;
    }
    if (prompts.length === 0) {
      console.log("(no prompts)");
      return;
    }
    const width = String(prompts.length).length;
    const labelChars = ctx.values.label ?? DEFAULT_LABEL_CHARS;
    for (const prompt of prompts) {
      console.log(
        `${String(prompt.index).padStart(width)}  ${promptLabel(prompt.text, labelChars)}`,
      );
    }
  },
});
