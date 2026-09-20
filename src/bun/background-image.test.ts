import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBackgroundImage } from "./background-image";

describe("resolveBackgroundImage", () => {
  test("空文字はnoneになる", () => {
    expect(resolveBackgroundImage("")).toBe("none");
    expect(resolveBackgroundImage("   ")).toBe("none");
  });

  test("CSSの関数形式はそのまま通す", () => {
    expect(resolveBackgroundImage("none")).toBe("none");
    expect(resolveBackgroundImage("linear-gradient(135deg, #1e1e2e, #313244)")).toBe(
      "linear-gradient(135deg, #1e1e2e, #313244)",
    );
    expect(resolveBackgroundImage('url("https://example.com/a.png")')).toBe(
      'url("https://example.com/a.png")',
    );
    expect(resolveBackgroundImage("  radial-gradient(circle, #000, #fff)  ")).toBe(
      "radial-gradient(circle, #000, #fff)",
    );
  });

  test("対応していない拡張子のパスはnoneになる", () => {
    expect(resolveBackgroundImage("/tmp/wallpaper.txt")).toBe("none");
  });

  test("読めないパスはnoneになる", () => {
    expect(resolveBackgroundImage("/definitely/missing/wallpaper.png")).toBe("none");
  });

  test("画像ファイルのパスはdata URIへ変換する", () => {
    const dir = mkdtempSync(join(tmpdir(), "niwaterm-bgimage-"));
    const file = join(dir, "wall.png");
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(resolveBackgroundImage(file)).toBe('url("data:image/png;base64,iVBORw==")');
  });

  test("拡張子の大文字小文字は区別しない", () => {
    const dir = mkdtempSync(join(tmpdir(), "niwaterm-bgimage-"));
    const file = join(dir, "wall.JPG");
    writeFileSync(file, Buffer.from([0xff, 0xd8]));
    expect(resolveBackgroundImage(file)).toBe('url("data:image/jpeg;base64,/9g=")');
  });
});
