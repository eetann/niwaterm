import { describe, expect, test } from "bun:test";
import { extractNavigatedUrl } from "./navigated-url";

describe("extractNavigatedUrl", () => {
  test("プレーンなURL文字列をそのまま返す", () => {
    expect(extractNavigatedUrl("https://example.com/a")).toBe("https://example.com/a");
  });

  test("JSON文字列のurlフィールドを取り出す", () => {
    expect(extractNavigatedUrl('{"url":"https://example.com/b"}')).toBe("https://example.com/b");
  });

  test("urlを持たないJSON文字列は元の文字列を返す", () => {
    expect(extractNavigatedUrl('{"title":"x"}')).toBe('{"title":"x"}');
  });

  test("文字列でないdetailは空文字列", () => {
    expect(extractNavigatedUrl(null)).toBe("");
    expect(extractNavigatedUrl({ url: "https://example.com" })).toBe("");
  });
});
