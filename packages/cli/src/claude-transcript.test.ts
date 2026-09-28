import { describe, expect, test } from "bun:test";
import {
  findPrompt,
  listPrompts,
  parseJsonl,
  promptLabel,
  promptTurn,
  type TranscriptRow,
} from "./claude-transcript";

function jsonl(...rows: TranscriptRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

function userPrompt(uuid: string, text: string, source = "typed"): TranscriptRow {
  return { type: "user", uuid, promptSource: source, message: { role: "user", content: text } };
}

function assistantText(text: string): TranscriptRow {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
}

describe("parseJsonl", () => {
  test("壊れた行と空行を捨てて残りを読む", () => {
    const rows = parseJsonl(
      `${JSON.stringify({ type: "a" })}\n\n{"type":\n${JSON.stringify({ type: "b" })}`,
    );
    expect(rows.map((r) => r.type)).toEqual(["a", "b"]);
  });

  test("配列やプリミティブの行は捨てる", () => {
    expect(parseJsonl('[1,2]\n"str"\n3\nnull')).toEqual([]);
  });
});

describe("listPrompts", () => {
  test("promptSourceを持つuser行だけを拾い、systemは外す", () => {
    const rows = parseJsonl(
      jsonl(
        userPrompt("u1", "最初の質問"),
        assistantText("答え"),
        {
          type: "user",
          uuid: "r1",
          message: { content: [{ type: "tool_result", content: "結果" }] },
        },
        userPrompt("s1", "<task-notification>…", "system"),
        userPrompt("u2", "次の質問", "queued"),
      ),
    );
    expect(listPrompts(rows).map((p) => [p.index, p.uuid, p.source, p.text])).toEqual([
      [1, "u1", "typed", "最初の質問"],
      [2, "u2", "queued", "次の質問"],
    ]);
  });

  test("サブエージェントのやりとりとメタ行は拾わない", () => {
    const rows = parseJsonl(
      jsonl(
        { ...userPrompt("side", "サブの指示"), isSidechain: true },
        { ...userPrompt("meta", "caveat"), isMeta: true, promptSource: undefined },
        userPrompt("u1", "本人の質問"),
      ),
    );
    expect(listPrompts(rows).map((p) => p.uuid)).toEqual(["u1"]);
  });

  test("timestampが前後してもファイルの行順で番号を振る", () => {
    const rows = parseJsonl(
      jsonl(
        { ...userPrompt("u1", "先に書かれた"), timestamp: "2026-09-28T10:00:05.000Z" },
        { ...userPrompt("u2", "後に書かれた"), timestamp: "2026-09-28T10:00:01.000Z" },
      ),
    );
    expect(listPrompts(rows).map((p) => [p.index, p.text])).toEqual([
      [1, "先に書かれた"],
      [2, "後に書かれた"],
    ]);
  });

  test("contentが配列のtextブロックでも本文を取り出す", () => {
    const rows = parseJsonl(
      jsonl({
        type: "user",
        uuid: "u1",
        promptSource: "typed",
        message: { content: [{ type: "text", text: "配列の本文" }, { type: "image" }] },
      }),
    );
    expect(listPrompts(rows)[0]?.text).toBe("配列の本文");
  });

  test("本文が空のプロンプトは並べない", () => {
    expect(listPrompts(parseJsonl(jsonl(userPrompt("u1", "   "))))).toEqual([]);
  });
});

describe("findPrompt", () => {
  const prompts = listPrompts(
    parseJsonl(jsonl(userPrompt("aaaa1111", "ひとつめ"), userPrompt("bbbb2222", "ふたつめ"))),
  );

  test("1始まりの通し番号で引ける", () => {
    expect(findPrompt(prompts, "2")?.uuid).toBe("bbbb2222");
  });

  test("uuidと前方一致で引ける", () => {
    expect(findPrompt(prompts, "aaaa1111")?.text).toBe("ひとつめ");
    expect(findPrompt(prompts, "bbbb")?.text).toBe("ふたつめ");
  });

  test("範囲外・空・未知のキーはnull", () => {
    expect(findPrompt(prompts, "3")).toBeNull();
    expect(findPrompt(prompts, "0")).toBeNull();
    expect(findPrompt(prompts, " ")).toBeNull();
    expect(findPrompt(prompts, "zzzz")).toBeNull();
  });
});

describe("promptTurn", () => {
  const rows = parseJsonl(
    jsonl(
      userPrompt("u1", "最初の質問"),
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "考え中" },
            { type: "text", text: "調べるね" },
            { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
          ],
        },
      },
      { type: "user", message: { content: [{ type: "tool_result", content: "file.txt" }] } },
      assistantText("終わったよ"),
      userPrompt("u2", "次の質問"),
      assistantText("次の答え"),
    ),
  );
  const prompts = listPrompts(rows);

  test("次のプロンプト境界の直前までを切り出す", () => {
    expect(promptTurn(rows, prompts[0]!)).toEqual([
      { kind: "prompt", text: "最初の質問" },
      { kind: "thinking", text: "考え中" },
      { kind: "assistant", text: "調べるね" },
      { kind: "tool", name: "Bash", input: "ls -la" },
      { kind: "tool-result", text: "file.txt", truncated: false },
      { kind: "assistant", text: "終わったよ" },
    ]);
  });

  test("systemが差し込んだプロンプトも境界になる", () => {
    const withSystem = parseJsonl(
      jsonl(
        userPrompt("u1", "質問"),
        assistantText("答え"),
        userPrompt("s1", "<task-notification>", "system"),
        assistantText("通知への応答"),
      ),
    );
    expect(promptTurn(withSystem, listPrompts(withSystem)[0]!)).toEqual([
      { kind: "prompt", text: "質問" },
      { kind: "assistant", text: "答え" },
    ]);
  });

  test("tool_resultを指定文字数で打ち切る", () => {
    const long = parseJsonl(
      jsonl(userPrompt("u1", "質問"), {
        type: "user",
        message: { content: [{ type: "tool_result", content: "あ".repeat(50) }] },
      }),
    );
    expect(promptTurn(long, listPrompts(long)[0]!, { maxResultChars: 10 })[1]).toEqual({
      kind: "tool-result",
      text: "あ".repeat(10),
      truncated: true,
    });
  });

  test("サブエージェントの行は既定で外し、指定すれば含める", () => {
    const withSide = parseJsonl(
      jsonl(userPrompt("u1", "質問"), { ...assistantText("サブの発言"), isSidechain: true }),
    );
    const prompt = listPrompts(withSide)[0]!;
    expect(promptTurn(withSide, prompt)).toHaveLength(1);
    expect(promptTurn(withSide, prompt, { includeSidechain: true })).toHaveLength(2);
  });

  test("transcriptに無いプロンプトは空配列", () => {
    expect(
      promptTurn(rows, { index: 9, uuid: "none", source: "typed", timestamp: "", text: "" }),
    ).toEqual([]);
  });
});

describe("promptLabel", () => {
  test("改行と連続空白を畳んで1行にする", () => {
    expect(promptLabel("複数行の\n\n  プロンプト ", 100)).toBe("複数行の プロンプト");
  });

  test("長い本文は省略記号を付けて切る", () => {
    expect(promptLabel("あいうえおかきくけこ", 5)).toBe("あいうえお…");
  });

  test("サロゲートペアの途中では切らない", () => {
    // コードポイント単位で数えるので、結合絵文字（ZWJシーケンス）は途中で切れる
    expect(promptLabel("🎉🎊🎈", 2)).toBe("🎉🎊…");
  });

  test("上限以内の本文はそのまま返す", () => {
    expect(promptLabel("短い", 10)).toBe("短い");
  });
});
