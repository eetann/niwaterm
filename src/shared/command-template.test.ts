import { describe, expect, test } from "bun:test";
import {
  emptyFieldNames,
  fieldNamesOf,
  parseCommandTemplate,
  quoteShellArg,
  renderCommandTemplate,
} from "./command-template";

describe("parseCommandTemplate", () => {
  test("地の文と{{name}}の並びへ分解する", () => {
    expect(parseCommandTemplate("niwa worktree new {{branch}} --workspace {{ws}}")).toEqual([
      { kind: "text", text: "niwa worktree new " },
      { kind: "field", name: "branch" },
      { kind: "text", text: " --workspace " },
      { kind: "field", name: "ws" },
    ]);
  });

  test("括弧の内側の空白は無視する", () => {
    expect(parseCommandTemplate("echo {{ name }}")).toEqual([
      { kind: "text", text: "echo " },
      { kind: "field", name: "name" },
    ]);
  });

  test("nameにできない{{...}}は地の文のまま残す", () => {
    expect(parseCommandTemplate("echo {{1x}} {{}} {{a b}}")).toEqual([
      { kind: "text", text: "echo {{1x}} {{}} {{a b}}" },
    ]);
  });

  test("{{name}}が無ければ全体が地の文になる", () => {
    expect(parseCommandTemplate("ls -la")).toEqual([{ kind: "text", text: "ls -la" }]);
  });
});

describe("fieldNamesOf", () => {
  test("最初に出てきた順に重複なく返す", () => {
    const segments = parseCommandTemplate("foo {{to}} {{from}} {{to}}");
    expect(fieldNamesOf(segments)).toEqual(["to", "from"]);
  });
});

describe("quoteShellArg", () => {
  test.each([
    ["feat/sidebar-dnd", "feat/sidebar-dnd"],
    ["2026-09-20", "2026-09-20"],
    ["project-red-92.csv", "project-red-92.csv"],
    ["a=b,c:d@e%f+g", "a=b,c:d@e%f+g"],
  ])("安全な文字だけの%sはそのまま", (value, expected) => {
    expect(quoteShellArg(value)).toBe(expected);
  });

  test.each([
    ["hello world", "'hello world'"],
    ["$HOME", "'$HOME'"],
    ["~/foo", "'~/foo'"],
    ["🌱 niwaterm", "'🌱 niwaterm'"],
    ["it's", `'it'"'"'s'`],
  ])("%sはシングルクォートで囲む", (value, expected) => {
    expect(quoteShellArg(value)).toBe(expected);
  });
});

describe("renderCommandTemplate", () => {
  const segments = parseCommandTemplate("foo --from {{from}} --msg {{msg}} {{args}} {{from}}");

  test("値を埋め、quoteがfalseのnameはそのまま埋める", () => {
    expect(
      renderCommandTemplate(
        segments,
        { from: "2026-09-20", msg: "hi there", args: "-v --dry-run" },
        { args: false },
      ),
    ).toBe("foo --from 2026-09-20 --msg 'hi there' -v --dry-run 2026-09-20");
  });

  test("値の無いnameは空文字列になる", () => {
    expect(renderCommandTemplate(segments, {}, {})).toBe("foo --from  --msg   ");
  });
});

describe("emptyFieldNames", () => {
  test("空の欄のnameを並び順で返す", () => {
    expect(emptyFieldNames(["a", "b", "c"], { a: "x", b: "" })).toEqual(["b", "c"]);
  });
});
