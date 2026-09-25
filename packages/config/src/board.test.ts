import { describe, expect, test } from "bun:test";
import { defaultBoardConfig, normalizeBoardPhases, resolveBoardPhase } from "./board";

describe("defaultBoardConfig", () => {
  test("既定では候補なし（サイドバーのメニューは案内だけを出す）", () => {
    expect(defaultBoardConfig.phases).toEqual([]);
  });
});

describe("normalizeBoardPhases", () => {
  test("labelを省略するとidがそのまま表示名になる", () => {
    expect(normalizeBoardPhases([{ id: "review" }])).toEqual([
      { id: "review", label: "review", color: null },
    ]);
  });

  test("label・colorはそのまま通す", () => {
    expect(normalizeBoardPhases([{ id: "plan", label: "プラン作成", color: "#89b4fa" }])).toEqual([
      { id: "plan", label: "プラン作成", color: "#89b4fa" },
    ]);
  });

  test("不正な要素だけを落とし、残りは生かす", () => {
    const phases = normalizeBoardPhases([
      { id: "ok" },
      { id: "" },
      { id: "空白 は不可" },
      { id: "label-empty", label: "" },
      { label: "idなし" },
      "文字列",
      null,
      { id: "ok2" },
    ]);

    expect(phases.map((s) => s.id)).toEqual(["ok", "ok2"]);
  });

  test("idの重複は先勝ち（CLI・キーバインドの指定が一意に解決できる状態を保つ）", () => {
    const phases = normalizeBoardPhases([
      { id: "review", label: "先" },
      { id: "review", label: "後" },
    ]);

    expect(phases).toEqual([{ id: "review", label: "先", color: null }]);
  });

  test("配列でない値は候補なしとして扱う", () => {
    expect(normalizeBoardPhases(undefined)).toEqual([]);
    expect(normalizeBoardPhases({ id: "review" })).toEqual([]);
  });
});

describe("resolveBoardPhase", () => {
  const phases = normalizeBoardPhases([{ id: "review", label: "レビュー", color: "#f9e2af" }]);

  test("候補にあるidはlabel・colorを引く", () => {
    expect(resolveBoardPhase(phases, "review")).toEqual({
      id: "review",
      label: "レビュー",
      color: "#f9e2af",
    });
  });

  test("候補に無い文字列は値そのものをラベルにし、色は既定へ任せる", () => {
    expect(resolveBoardPhase(phases, "あとで直す")).toEqual({
      id: "あとで直す",
      label: "あとで直す",
      color: null,
    });
  });
});
