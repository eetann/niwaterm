import { describe, expect, test } from "bun:test";
import {
  type CommandTrackerEvent,
  createCommandTracker,
  decodeCmdlineUrl,
  parseSemanticPromptPayload,
} from "./command-tracker";

const enc = (s: string) => new TextEncoder().encode(s);

function collect(chunks: string[]): CommandTrackerEvent[] {
  const events: CommandTrackerEvent[] = [];
  const tracker = createCommandTracker((e) => events.push(e));
  for (const chunk of chunks) tracker.feed(enc(chunk));
  return events;
}

describe("decodeCmdlineUrl", () => {
  test("%XXをUTF-8のバイト列として戻す", () => {
    expect(decodeCmdlineUrl("nvim%20%E3%83%A1%E3%83%A2.md")).toBe("nvim メモ.md");
  });

  test("エンコードされていない文字・不正な%はそのまま", () => {
    expect(decodeCmdlineUrl("nvim メモ 100%")).toBe("nvim メモ 100%");
  });
});

describe("parseSemanticPromptPayload", () => {
  test("A・Dで実行中でなくなる", () => {
    expect(parseSemanticPromptPayload("A")).toEqual({ kind: "end" });
    expect(parseSemanticPromptPayload("D;0")).toEqual({ kind: "end" });
  });

  test("Cのcmdline_urlを取り出す", () => {
    expect(parseSemanticPromptPayload("C;cmdline_url=nvim%20a%3Bb")).toEqual({
      kind: "start",
      cmdline: "nvim a;b",
    });
  });

  test("コマンド行の無いC・Bは無視する", () => {
    expect(parseSemanticPromptPayload("C")).toBeNull();
    expect(parseSemanticPromptPayload("B")).toBeNull();
  });
});

describe("createCommandTracker", () => {
  test("BEL終端・ST終端の両方を拾う", () => {
    expect(collect(["out\x1b]133;C;cmdline_url=nvim\x07text\x1b]133;A\x1b\\prompt"])).toEqual([
      { kind: "start", cmdline: "nvim" },
      { kind: "end" },
    ]);
  });

  test("チャンクの境目で切れたシーケンスも拾う", () => {
    const seq = "\x1b]133;C;cmdline_url=claude%20--continue\x07";
    for (let cut = 1; cut < seq.length; cut++) {
      expect(collect([`x${seq.slice(0, cut)}`, `${seq.slice(cut)}y`])).toEqual([
        { kind: "start", cmdline: "claude --continue" },
      ]);
    }
  });

  test("他のOSC・133以外の番号は無視する", () => {
    expect(collect(["\x1b]7;file:///tmp\x07\x1b]1337;foo\x07\x1b]13;x\x07"])).toEqual([]);
  });

  test("途中で別のESCシーケンスが始まったら読み捨てて、そこから読み直す", () => {
    expect(collect(["\x1b]133;C;cmdline_url=nvim\x1b[0m\x1b]133;A\x07"])).toEqual([
      { kind: "end" },
    ]);
  });
});
