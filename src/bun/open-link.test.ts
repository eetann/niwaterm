import { describe, expect, test } from "bun:test";
import { isAllowedLinkUrl } from "./open-link";

describe("isAllowedLinkUrl", () => {
  test("httpは許可する", () => {
    expect(isAllowedLinkUrl("http://example.com")).toBe(true);
  });

  test("httpsは許可する", () => {
    expect(isAllowedLinkUrl("https://example.com/path?a=1")).toBe(true);
  });

  test("mailtoは許可する", () => {
    expect(isAllowedLinkUrl("mailto:test@example.com")).toBe(true);
  });

  test("fileは拒否する", () => {
    expect(isAllowedLinkUrl("file:///etc/passwd")).toBe(false);
  });

  test("javascriptは拒否する", () => {
    expect(isAllowedLinkUrl("javascript:alert(1)")).toBe(false);
  });

  test("カスタムスキーム(slack://等)は拒否する", () => {
    expect(isAllowedLinkUrl("slack://open")).toBe(false);
  });

  test("不正なURLはfalseを返す", () => {
    expect(isAllowedLinkUrl("not a url")).toBe(false);
  });

  test("空文字列はfalseを返す", () => {
    expect(isAllowedLinkUrl("")).toBe(false);
  });
});
