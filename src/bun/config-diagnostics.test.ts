import { describe, expect, spyOn, test } from "bun:test";
import { createConfigDiagnostics, describeValue } from "./config-diagnostics";

describe("createConfigDiagnostics", () => {
  test("積んだ順にlevel・scope付きで取り出せる", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const diag = createConfigDiagnostics();
      diag.warn("appearance.fontSize", "値が不正");
      diag.error("keybindings", "関数が失敗");
      expect(diag.list()).toEqual([
        { level: "warn", scope: "appearance.fontSize", message: "値が不正" },
        { level: "error", scope: "keybindings", message: "関数が失敗" },
      ]);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("同じ内容をconsole.logへも流す（ターミナルで追っているときの手がかり）", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      createConfigDiagnostics().warn("shell.default", "文字列ではない");
      expect(logSpy).toHaveBeenCalledWith("[bun] config warn: shell.default: 文字列ではない");
    } finally {
      logSpy.mockRestore();
    }
  });

  test("listは呼んだ時点のスナップショットを返す（後から積んでも過去の結果は変わらない）", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const diag = createConfigDiagnostics();
      diag.warn("a", "1");
      const snapshot = diag.list();
      diag.warn("b", "2");
      expect(snapshot).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("describeValue", () => {
  test("文字列は引用符で囲む（空文字・前後の空白を見えるようにする）", () => {
    expect(describeValue("")).toBe('""');
    expect(describeValue(" ctrl+b ")).toBe('" ctrl+b "');
  });

  test("関数は中身ではなく種別だけを出す", () => {
    expect(describeValue(() => {})).toBe("(関数)");
  });

  test("オブジェクト・配列はJSONで出す", () => {
    expect(describeValue({ id: "a" })).toBe('{"id":"a"}');
    expect(describeValue([1, 2])).toBe("[1,2]");
  });

  test("JSONにできない値でも例外にせず文字列化する", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(describeValue(circular)).toBe("[object Object]");
    expect(describeValue(undefined)).toBe("undefined");
  });
});
