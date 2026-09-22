import { describe, expect, test } from "bun:test";
import { assignHintLabels, HINT_CHARS, matchHintInput } from "./hint-labels";

describe("assignHintLabels", () => {
  test("文字数に収まるうちは1文字ラベルだけを配る", () => {
    expect(assignHintLabels(3, "abc")).toEqual(["a", "b", "c"]);
  });

  test("0個なら空配列", () => {
    expect(assignHintLabels(0, "abc")).toEqual([]);
  });

  test("溢れた分だけ最短のラベルが2文字へ展開される", () => {
    // 3文字で4個 → aを取り除いてaa/ab/acへ展開し、残ったb/cは1文字のまま
    expect(assignHintLabels(4, "abc")).toEqual(["b", "c", "aa", "ab"]);
    expect(assignHintLabels(5, "abc")).toEqual(["b", "c", "aa", "ab", "ac"]);
    expect(assignHintLabels(7, "abc")).toEqual(["c", "aa", "ab", "ac", "ba", "bb", "bc"]);
  });

  test("2文字でも足りなければ3文字へ展開する", () => {
    const labels = assignHintLabels(20, "abc");
    expect(labels).toHaveLength(20);
    expect(labels.at(-1)).toHaveLength(3);
  });

  test("どのラベルも他のラベルの接頭辞にならない", () => {
    for (const count of [1, 9, 10, 17, 30, 100]) {
      const labels = assignHintLabels(count);
      expect(labels).toHaveLength(count);
      expect(new Set(labels).size).toBe(count);
      for (const label of labels) {
        expect(labels.filter((other) => other !== label && other.startsWith(label))).toEqual([]);
      }
    }
  });

  test("既定の文字数までは1文字ラベルで収まる", () => {
    expect(assignHintLabels(HINT_CHARS.length)).toEqual([...HINT_CHARS]);
  });

  test("文字が1つしかないと展開できないので空配列", () => {
    expect(assignHintLabels(3, "a")).toEqual([]);
  });
});

describe("matchHintInput", () => {
  const labels = ["a", "b", "ca", "cb"];

  test("完全一致したラベルを返す", () => {
    expect(matchHintInput(labels, "a")).toEqual({ kind: "exact", label: "a" });
    expect(matchHintInput(labels, "cb")).toEqual({ kind: "exact", label: "cb" });
  });

  test("続きのあるラベルが残っていればpending", () => {
    expect(matchHintInput(labels, "c")).toEqual({ kind: "pending" });
    expect(matchHintInput(labels, "")).toEqual({ kind: "pending" });
  });

  test("どのラベルにも繋がらなければnone", () => {
    expect(matchHintInput(labels, "z")).toEqual({ kind: "none" });
    expect(matchHintInput(labels, "cz")).toEqual({ kind: "none" });
  });

  test("対象が無ければ空打鍵でもnone", () => {
    expect(matchHintInput([], "")).toEqual({ kind: "none" });
  });
});
