import { describe, expect, test } from "bun:test";
import {
  defaultSidebarConfig,
  formatSidebarBoardStatusSource,
  normalizeSidebarBoardStatus,
  parseSidebarBoardStatusSource,
} from "./sidebar";

describe("defaultSidebarConfig", () => {
  test("既定はフェーズ・ブランチ・エージェント状態の3つ", () => {
    expect(defaultSidebarConfig.boardStatus.map((item) => item.source)).toEqual([
      { kind: "builtin", id: "phase" },
      { kind: "builtin", id: "branch" },
      { kind: "builtin", id: "agent" },
    ]);
  });
});

describe("parseSidebarBoardStatusSource", () => {
  test("ビルトインのidを解釈する", () => {
    expect(parseSidebarBoardStatusSource("builtin:branch")).toEqual({
      kind: "builtin",
      id: "branch",
    });
  });

  test("tab-varは変数名を取り出す", () => {
    expect(parseSidebarBoardStatusSource("tab-var:ticket")).toEqual({
      kind: "tab-var",
      name: "ticket",
    });
  });

  test("未知のビルトイン・接頭辞なし・不正な変数名はnull", () => {
    expect(parseSidebarBoardStatusSource("builtin:unknown")).toBeNull();
    expect(parseSidebarBoardStatusSource("branch")).toBeNull();
    expect(parseSidebarBoardStatusSource("tab-var:")).toBeNull();
    expect(parseSidebarBoardStatusSource("tab-var:空白 は不可")).toBeNull();
  });

  test("formatSidebarBoardStatusSourceで設定に書いた文字列へ戻る", () => {
    for (const source of ["builtin:phase", "builtin:agent", "tab-var:ticket"]) {
      const parsed = parseSidebarBoardStatusSource(source);
      expect(parsed && formatSidebarBoardStatusSource(parsed)).toBe(source);
    }
  });
});

describe("normalizeSidebarBoardStatus", () => {
  test("文字列だけで書くとprefix・colorは未指定になる", () => {
    expect(normalizeSidebarBoardStatus(["builtin:branch"])).toEqual([
      { source: { kind: "builtin", id: "branch" }, prefix: null, color: null },
    ]);
  });

  test("並べた順を保つ（サイドバーの表示順になる）", () => {
    const items = normalizeSidebarBoardStatus(["builtin:agent", "tab-var:ticket", "builtin:phase"]);

    expect(items.map((item) => formatSidebarBoardStatusSource(item.source))).toEqual([
      "builtin:agent",
      "tab-var:ticket",
      "builtin:phase",
    ]);
  });

  test("オブジェクト形式のprefix・colorはそのまま通す", () => {
    expect(
      normalizeSidebarBoardStatus([{ source: "tab-var:ticket", prefix: "#", color: "#f9e2af" }]),
    ).toEqual([{ source: { kind: "tab-var", name: "ticket" }, prefix: "#", color: "#f9e2af" }]);
  });

  test("prefixは空文字列も通す（ビルトインの既定ラベルを消す指定になる）", () => {
    expect(normalizeSidebarBoardStatus([{ source: "builtin:branch", prefix: "" }])).toEqual([
      { source: { kind: "builtin", id: "branch" }, prefix: "", color: null },
    ]);
  });

  test("不正な要素だけを落とし、残りは生かす", () => {
    const items = normalizeSidebarBoardStatus([
      "builtin:branch",
      "builtin:unknown",
      { source: "tab-var:ok" },
      { source: 1 },
      { prefix: "sourceなし" },
      { source: "tab-var:bad-color", color: "" },
      null,
      "builtin:agent",
    ]);

    expect(items.map((item) => formatSidebarBoardStatusSource(item.source))).toEqual([
      "builtin:branch",
      "tab-var:ok",
      "builtin:agent",
    ]);
  });

  test("同じ出どころの重複は先勝ち", () => {
    const items = normalizeSidebarBoardStatus([
      { source: "builtin:branch", prefix: "先" },
      { source: "builtin:branch", prefix: "後" },
    ]);

    expect(items).toEqual([
      { source: { kind: "builtin", id: "branch" }, prefix: "先", color: null },
    ]);
  });

  test("空配列は尊重する（ステータスラインを出さない指定）", () => {
    expect(normalizeSidebarBoardStatus([])).toEqual([]);
  });

  test("未指定・配列でない値は既定へ戻す", () => {
    expect(normalizeSidebarBoardStatus(undefined)).toEqual(defaultSidebarConfig.boardStatus);
    expect(normalizeSidebarBoardStatus("builtin:branch")).toEqual(defaultSidebarConfig.boardStatus);
  });
});
