import { defaultLinkRules, type ResolvedLinkRule, toResolvedLinkRule } from "@niwaterm/config";
import { describe, expect, test } from "bun:test";
import { compileLinkRules, findLinkAt } from "./link-detect";

const resolvedDefaults = defaultLinkRules
  .map(toResolvedLinkRule)
  .filter((rule): rule is ResolvedLinkRule => rule !== null);
const rules = compileLinkRules(resolvedDefaults);

/** 行の中でtargetが始まる桁を返す（半角だけの行を前提にしたテスト用ヘルパー） */
function colOf(line: string, target: string): number {
  return line.indexOf(target);
}

describe("findLinkAt（既定ルール）", () => {
  test("URLの上の桁ならURLを返す", () => {
    const line = "see https://example.com/path for details";
    const span = findLinkAt(line, colOf(line, "https"), rules);
    expect(span).toEqual({
      url: "https://example.com/path",
      text: "https://example.com/path",
      startCol: 4,
      endCol: 28,
    });
  });

  test("URLの途中・末尾の桁でも同じ範囲を返す", () => {
    const line = "https://example.com";
    expect(findLinkAt(line, 10, rules)?.url).toBe("https://example.com");
    expect(findLinkAt(line, line.length - 1, rules)?.url).toBe("https://example.com");
  });

  test("URLの外の桁ではnull", () => {
    const line = "see https://example.com now";
    expect(findLinkAt(line, 0, rules)).toBeNull();
    expect(findLinkAt(line, line.length - 1, rules)).toBeNull();
  });

  test("直後の句読点・閉じ括弧はURLへ含めない", () => {
    const line = "(https://example.com/a), next";
    const span = findLinkAt(line, 5, rules);
    expect(span?.text).toBe("https://example.com/a");
    // 閉じ括弧の桁はリンクの外
    expect(findLinkAt(line, colOf(line, ")"), rules)).toBeNull();
  });

  test("行内に複数のURLがあればクリックした側を返す", () => {
    const line = "https://a.example.com https://b.example.com";
    expect(findLinkAt(line, 0, rules)?.url).toBe("https://a.example.com");
    expect(findLinkAt(line, colOf(line, "https://b"), rules)?.url).toBe("https://b.example.com");
  });

  test("メールアドレスはmailto:を補う", () => {
    const line = "contact: user.name+tag@example.co.jp";
    const span = findLinkAt(line, colOf(line, "user"), rules);
    expect(span?.url).toBe("mailto:user.name+tag@example.co.jp");
    expect(span?.text).toBe("user.name+tag@example.co.jp");
  });

  test("スキーム付きのmailtoはそのまま開く", () => {
    const line = "mailto:user@example.com";
    expect(findLinkAt(line, 0, rules)?.url).toBe("mailto:user@example.com");
  });

  test("http/https以外のスキームは既定では拾わない", () => {
    const line = "file:///etc/passwd";
    expect(findLinkAt(line, 2, rules)).toBeNull();
  });

  test("全角文字を含む行では桁がずれない", () => {
    const line = "資料は https://example.com です";
    // "資料は " は全角3文字＋半角空白で7桁
    const span = findLinkAt(line, 7, rules);
    expect(span?.startCol).toBe(7);
    expect(span?.endCol).toBe(7 + "https://example.com".length);
    // URLより手前（全角文字の上）ではnull
    expect(findLinkAt(line, 0, rules)).toBeNull();
  });

  test("空行・負の桁ではnull", () => {
    expect(findLinkAt("", 0, rules)).toBeNull();
    expect(findLinkAt("https://example.com", -1, rules)).toBeNull();
  });
});

describe("compileLinkRules", () => {
  test("不正なパターンは落として残りのルールで動かす", () => {
    const compiled = compileLinkRules([
      { source: "[", flags: "", format: "$0" },
      { source: "ISSUE-(\\d+)", flags: "", format: "https://example.com/issues/$1" },
    ]);
    expect(compiled).toHaveLength(1);
    expect(findLinkAt("fix ISSUE-1234 now", 6, compiled)).toEqual({
      url: "https://example.com/issues/1234",
      text: "ISSUE-1234",
      startCol: 4,
      endCol: 14,
    });
  });

  test("ユーザー指定のフラグを保ったままgを足す", () => {
    const compiled = compileLinkRules([{ source: "todo", flags: "i", format: "$0" }]);
    expect(compiled[0]?.re.flags).toBe("gi");
    expect(findLinkAt("TODO", 0, compiled)?.text).toBe("TODO");
  });
});
