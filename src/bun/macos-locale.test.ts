import { describe, expect, test } from "bun:test";
import { fillMissingLocale, langFromAppleLocale } from "./macos-locale";

describe("langFromAppleLocale", () => {
  const installed = new Set(["ja_JP.UTF-8", "en_US.UTF-8"]);
  const exists = (name: string) => installed.has(name);

  test("実在するロケールはUTF-8付きで採用する", () => {
    expect(langFromAppleLocale("ja_JP\n", exists)).toBe("ja_JP.UTF-8");
  });

  test("カレンダー等の修飾子は落とす", () => {
    expect(langFromAppleLocale("ja_JP@calendar=japanese", exists)).toBe("ja_JP.UTF-8");
  });

  test("実在しない組み合わせ・未取得ならen_US.UTF-8へ落とす", () => {
    expect(langFromAppleLocale("en_JP", exists)).toBe("en_US.UTF-8");
    expect(langFromAppleLocale(undefined, exists)).toBe("en_US.UTF-8");
    expect(langFromAppleLocale("", exists)).toBe("en_US.UTF-8");
  });
});

describe("fillMissingLocale", () => {
  test("ロケール変数が無ければLANGを補う", () => {
    const env: Record<string, string> = {};
    fillMissingLocale(env, "ja_JP.UTF-8");
    expect(env["LANG"]).toBe("ja_JP.UTF-8");
  });

  test("どれか1つでも設定済みなら触らない", () => {
    for (const key of ["LANG", "LC_ALL", "LC_CTYPE"]) {
      const env: Record<string, string> = { [key]: "C.UTF-8" };
      fillMissingLocale(env, "ja_JP.UTF-8");
      expect(env).toEqual({ [key]: "C.UTF-8" });
    }
  });
});
