import { describe, expect, test } from "bun:test";
import { claudePromptJump } from "./claude-prompt-jump";
import type { HoverButtonContext } from "./hover-button";
import type { Niwa } from "./niwa";

function ctx(vars: Record<string, string>): HoverButtonContext {
  return { tabId: "tab-1", cwd: undefined, vars, tabName: undefined };
}

describe("claudePromptJump", () => {
  test("Claude Codeのtranscriptを持つタブにだけ出す", () => {
    const button = claudePromptJump();
    expect(button.show?.(ctx({ agent: "claude-code", agent_transcript: "/t.jsonl" }))).toBe(true);
    expect(button.show?.(ctx({ agent: "claude-code" }))).toBe(false);
    expect(button.show?.(ctx({ agent: "codex", agent_transcript: "/t.jsonl" }))).toBe(false);
  });

  test("目次は置き場所によらず縦に並べ、利用者のcssは後ろへ足す", () => {
    const button = claudePromptJump({ position: "bottom-right", css: ".extra {}" });
    expect(button.position).toBe("bottom-right");
    expect(button.css).toContain(".hover-panel:has(.claude-prompt-jump-mark)");
    expect(button.css?.trimEnd().endsWith(".extra {}")).toBe(true);
  });

  test("CLIの出力からプロンプトを並べ、本文はエスケープし、押すとタブ変数とキーを送る", async () => {
    const calls: string[] = [];
    const niwa = fakeNiwa(calls);
    const button = claudePromptJump({ cli: "niwa-dev" });
    const items = await button.items(ctx({}), niwa);
    expect(calls[0]).toBe("niwa-dev claude prompt list --json --tab tab-1");
    expect(items).toHaveLength(2);
    expect(items[0]?.label).toBe("1. <b>fix</b> bug");
    expect(items[0]?.html).toContain("&lt;b&gt;fix&lt;/b&gt; bug");
    await items[0]?.run();
    expect(calls.slice(1)).toEqual(["var tab-1 agent_jump u-1", "keys tab-1 C-]"]);
  });

  test("末尾の「最新へ」はタブ変数を触らずClaude Codeの最下部へ移すキーだけを送る", async () => {
    const calls: string[] = [];
    const items = await claudePromptJump().items(ctx({}), fakeNiwa(calls));
    expect(items.at(-1)?.label).toBe("最新へ");
    await items.at(-1)?.run();
    expect(calls.slice(1)).toEqual(["keys tab-1 C-End"]);
  });

  test("latestKey: falseなら「最新へ」を出さない", async () => {
    const items = await claudePromptJump({ latestKey: false }).items(ctx({}), fakeNiwa([]));
    expect(items).toHaveLength(1);
  });
});

function fakeNiwa(calls: string[]): Niwa {
  return {
    shell: {
      run: async (command: string) => {
        calls.push(command);
        const prompts = [{ index: 1, uuid: "u-1", text: "<b>fix</b>\n bug" }];
        return {
          exitCode: 0,
          stdout: `\u001b]7;file:///x\u0007${JSON.stringify(prompts)}`,
          stderr: "",
        };
      },
    },
    tab: {
      var: {
        set: (tabId: string, key: string, value: string) =>
          calls.push(`var ${tabId} ${key} ${value}`),
      },
      sendKeys: (tabId: string, ...keys: string[]) => calls.push(`keys ${tabId} ${keys.join(" ")}`),
    },
  } as unknown as Niwa;
}
