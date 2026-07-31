import { describe, expect, test } from "bun:test";
import { defaultBrowserConfig } from "./browser";

describe("defaultBrowserConfig", () => {
  test("defaultUrlは非空文字列", () => {
    expect(typeof defaultBrowserConfig.defaultUrl).toBe("string");
    expect(defaultBrowserConfig.defaultUrl.length).toBeGreaterThan(0);
  });
});
