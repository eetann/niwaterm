import { describe, expect, test } from "bun:test";
import { normalizeUrl } from "./normalize-url";

describe("normalizeUrl", () => {
  test.each([
    ["example.com", "https://example.com"],
    ["  example.com  ", "https://example.com"],
    ["localhost:3000", "https://localhost:3000"],
    ["192.168.1.1:8080", "https://192.168.1.1:8080"],
    ["http://example.com", "http://example.com"],
    ["https://example.com", "https://example.com"],
    ["about:blank", "about:blank"],
    ["file:///Users/foo/index.html", "file:///Users/foo/index.html"],
  ])("normalizeUrl(%p) -> %p", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });
});
