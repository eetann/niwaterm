import { describe, expect, it } from "bun:test";
import { splitPaletteCss } from "./terminal-session";

describe("splitPaletteCss", () => {
  it("先頭のパレット定義を本文から切り離す", () => {
    const result = splitPaletteCss("<style>:root{--vt-palette-0: #000;}</style><div>body</div>");
    expect(result).toEqual({
      paletteCss: ":root{--vt-palette-0: #000;}",
      body: "<div>body</div>",
    });
  });

  it("パレット定義が無ければ丸ごと本文として扱う", () => {
    const result = splitPaletteCss("<div>body</div>");
    expect(result).toEqual({ paletteCss: null, body: "<div>body</div>" });
  });

  it("閉じタグが無ければ切り出さず丸ごと本文として扱う", () => {
    const result = splitPaletteCss("<style>:root{--vt-palette-0: #000;}");
    expect(result).toEqual({ paletteCss: null, body: "<style>:root{--vt-palette-0: #000;}" });
  });

  it("本文側に現れる<style>は切り出しの対象にしない", () => {
    const result = splitPaletteCss("<div><style>x</style></div>");
    expect(result).toEqual({ paletteCss: null, body: "<div><style>x</style></div>" });
  });
});
