import { describe, expect, test } from "bun:test";
import { isAllowedLinkUrl, isBrowserTabUrl } from "./open-link";

describe("isBrowserTabUrl", () => {
  test("http/httpsはniwaterm内のブラウザタブで開ける", () => {
    expect(isBrowserTabUrl("http://example.com")).toBe(true);
    expect(isBrowserTabUrl("https://example.com/path?a=1")).toBe(true);
  });

  test("mailtoはブラウザタブでは扱えない", () => {
    expect(isBrowserTabUrl("mailto:test@example.com")).toBe(false);
  });

  test("URLとして解釈できない文字列はfalse", () => {
    expect(isBrowserTabUrl("not a url")).toBe(false);
  });
});

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
