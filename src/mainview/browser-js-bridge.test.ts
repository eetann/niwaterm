import { describe, expect, test } from "bun:test";
import { buildExecBrowserJsScript } from "./browser-js-bridge";

describe("buildExecBrowserJsScript", () => {
  test("requestIdをJSON文字列リテラルとして埋め込む", () => {
    const script = buildExecBrowserJsScript("bjs-1-123", "return 1;");
    expect(script).toContain('const __rid = "bjs-1-123";');
  });

  test("codeをasync関数本体としてそのまま埋め込む（エスケープしない）", () => {
    const script = buildExecBrowserJsScript("rid", "return document.title;");
    expect(script).toContain("await (async () => { return document.title; })()");
  });

  test("window.__electrobunEventBridgeへpostMessageする形になっている", () => {
    const script = buildExecBrowserJsScript("rid", "return 1;");
    expect(script).toContain("window.__electrobunEventBridge");
    expect(script).toContain('eventName: "host-message"');
    expect(script).toContain('id: "webviewEvent"');
  });

  test("requestIdに含まれるダブルクォートやバックスラッシュも安全にエスケープされる", () => {
    const script = buildExecBrowserJsScript('rid"with\\quote', "return 1;");
    // JSON.stringifyされた結果として構文的に妥当な文字列リテラルになっていること
    expect(() => new Function(script)).not.toThrow();
  });
});
