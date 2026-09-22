import { describe, expect, test } from "bun:test";
import { defaultBoardConfig, normalizeBoardStatuses, resolveBoardStatus } from "./board";

describe("defaultBoardConfig", () => {
  test("既定では候補なし（サイドバーのメニューは案内だけを出す）", () => {
    expect(defaultBoardConfig.statuses).toEqual([]);
  });
});

describe("normalizeBoardStatuses", () => {
  test("labelを省略するとidがそのまま表示名になる", () => {
    expect(normalizeBoardStatuses([{ id: "review" }])).toEqual([
      { id: "review", label: "review", color: null },
    ]);
  });

  test("label・colorはそのまま通す", () => {
    expect(normalizeBoardStatuses([{ id: "plan", label: "プラン作成", color: "#89b4fa" }])).toEqual(
      [{ id: "plan", label: "プラン作成", color: "#89b4fa" }],
    );
  });

  test("不正な要素だけを落とし、残りは生かす", () => {
    const statuses = normalizeBoardStatuses([
      { id: "ok" },
      { id: "" },
      { id: "空白 は不可" },
      { id: "label-empty", label: "" },
      { label: "idなし" },
      "文字列",
      null,
      { id: "ok2" },
    ]);

    expect(statuses.map((s) => s.id)).toEqual(["ok", "ok2"]);
  });

  test("idの重複は先勝ち（CLI・キーバインドの指定が一意に解決できる状態を保つ）", () => {
    const statuses = normalizeBoardStatuses([
      { id: "review", label: "先" },
      { id: "review", label: "後" },
    ]);

    expect(statuses).toEqual([{ id: "review", label: "先", color: null }]);
  });

  test("配列でない値は候補なしとして扱う", () => {
    expect(normalizeBoardStatuses(undefined)).toEqual([]);
    expect(normalizeBoardStatuses({ id: "review" })).toEqual([]);
  });
});

describe("resolveBoardStatus", () => {
  const statuses = normalizeBoardStatuses([{ id: "review", label: "レビュー", color: "#f9e2af" }]);

  test("候補にあるidはlabel・colorを引く", () => {
    expect(resolveBoardStatus(statuses, "review")).toEqual({
      id: "review",
      label: "レビュー",
      color: "#f9e2af",
    });
  });

  test("候補に無い文字列は値そのものをラベルにし、色は既定へ任せる", () => {
    expect(resolveBoardStatus(statuses, "あとで直す")).toEqual({
      id: "あとで直す",
      label: "あとで直す",
      color: null,
    });
  });
});
