import { describe, expect, test } from "bun:test";
import {
  decideResumeCommand,
  isBoardResumeEnabled,
  isLayoutTabResumeEnabled,
  splitShellWords,
} from "./resume-command";

describe("splitShellWords", () => {
  test("クォートとエスケープを外して単語に分ける", () => {
    expect(splitShellWords(`nvim "a b.md" 'c d' e\\ f`)).toEqual(["nvim", "a b.md", "c d", "e f"]);
  });

  test("閉じていないクォートはnull", () => {
    expect(splitShellWords(`nvim "foo`)).toBeNull();
  });
});

describe("decideResumeCommand", () => {
  const allow = ["nvim", "claude", "git log"];

  test("許可リストの単語単位の前方一致で通す", () => {
    expect(decideResumeCommand("nvim foo.md", allow)).toEqual({
      ok: true,
      command: "nvim foo.md",
    });
    expect(decideResumeCommand("git log --oneline", allow)).toEqual({
      ok: true,
      command: "git log --oneline",
    });
  });

  test("単語の途中までの一致は通さない", () => {
    expect(decideResumeCommand("nvimdiff a b", allow)).toEqual({
      ok: false,
      reason: "not-allowed",
    });
    expect(decideResumeCommand("git status", allow)).toEqual({ ok: false, reason: "not-allowed" });
  });

  test("先頭の環境変数代入は外して判定し、打ち直すのは代入込みの元の行", () => {
    const line = "CLAUDE_CONFIG_DIR=~/.claude-work FOO='a b' claude --continue";
    expect(decideResumeCommand(line, allow)).toEqual({ ok: true, command: line });
  });

  test("環境変数代入だけの行は打ち直さない", () => {
    expect(decideResumeCommand("FOO=1", allow)).toEqual({ ok: false, reason: "empty" });
  });

  test("パス付きのコマンドは名前で照合する", () => {
    expect(decideResumeCommand("/usr/bin/nvim foo", allow).ok).toBe(true);
  });

  test.each([
    "nvim foo; rm -rf x",
    "nvim foo && make",
    "nvim foo || true",
    "nvim foo | tee log",
    "nvim $(cat list)",
    "nvim `cat list`",
    "nvim foo > out",
    "nvim < in",
    "nvim foo &",
    "nvim foo\nrm x",
    "FOO=$(curl x) claude",
  ])("複合コマンドは許可リストに関係なく打ち直さない: %p", (line) => {
    expect(decideResumeCommand(line, allow)).toEqual({ ok: false, reason: "compound" });
  });

  test("denyリストは許可リストより強い", () => {
    expect(decideResumeCommand("rm -rf build", ["rm"])).toEqual({ ok: false, reason: "denied" });
    expect(decideResumeCommand("git push origin main", ["git"])).toEqual({
      ok: false,
      reason: "denied",
    });
  });

  test("denyリストは別のコマンド経由・クォートの中・パス付きでも当たる", () => {
    expect(decideResumeCommand("watch rm -rf x", ["watch"]).ok).toBe(false);
    expect(decideResumeCommand(`bash -c "rm -rf x"`, ["bash"]).ok).toBe(false);
    expect(decideResumeCommand("sudo nvim /etc/hosts", ["sudo"]).ok).toBe(false);
    expect(decideResumeCommand("/bin/rm x", ["/bin/rm"]).ok).toBe(false);
  });

  test("denyリストの複数語は連続した並びでだけ当たる", () => {
    expect(decideResumeCommand("git log --grep push", ["git log"]).ok).toBe(true);
  });

  test("閉じていないクォートは打ち直さない", () => {
    expect(decideResumeCommand(`nvim "foo`, allow)).toEqual({ ok: false, reason: "unparsable" });
  });

  test("許可リストが空なら何も打ち直さない", () => {
    expect(decideResumeCommand("nvim foo", [])).toEqual({ ok: false, reason: "not-allowed" });
  });
});

describe("isBoardResumeEnabled", () => {
  test("手動の切り替えが設定より優先される", () => {
    expect(isBoardResumeEnabled(null, true)).toBe(true);
    expect(isBoardResumeEnabled(false, true)).toBe(false);
    expect(isBoardResumeEnabled(true, false)).toBe(true);
  });
});

describe("isLayoutTabResumeEnabled", () => {
  test("手動 → タブ → プリセットの順に優先し、どれも無ければ打ち直さない", () => {
    expect(isLayoutTabResumeEnabled(null, undefined, undefined)).toBe(false);
    expect(isLayoutTabResumeEnabled(null, undefined, true)).toBe(true);
    expect(isLayoutTabResumeEnabled(null, false, true)).toBe(false);
    expect(isLayoutTabResumeEnabled(false, true, true)).toBe(false);
    expect(isLayoutTabResumeEnabled(true, false, false)).toBe(true);
  });
});
