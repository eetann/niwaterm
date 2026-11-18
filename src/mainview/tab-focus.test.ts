import { describe, expect, test } from "bun:test";
import { pickTabTarget } from "./tab-focus";

describe("pickTabTarget", () => {
  const list = ["a", "b", "c"];

  test("次・前の候補を返す", () => {
    expect(pickTabTarget(list, "a", false)).toBe("b");
    expect(pickTabTarget(list, "b", true)).toBe("a");
  });

  test("端では反対の端へ回り込む", () => {
    expect(pickTabTarget(list, "c", false)).toBe("a");
    expect(pickTabTarget(list, "a", true)).toBe("c");
  });

  test("現在の要素が候補に無いときは進む向きの端を返す", () => {
    expect(pickTabTarget(list, null, false)).toBe("a");
    expect(pickTabTarget(list, "x", true)).toBe("c");
  });

  test("候補が無ければnull", () => {
    expect(pickTabTarget([], "a", false)).toBeNull();
  });
});
