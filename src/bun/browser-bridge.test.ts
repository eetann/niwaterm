import { describe, expect, test } from "bun:test";
import { type BrowserBridgeRpc, createBrowserBridge } from "./browser-bridge";

function createFakeRpc(overrides: Partial<BrowserBridgeRpc["request"]> = {}): BrowserBridgeRpc {
  return {
    request: {
      browserNavigate: overrides.browserNavigate ?? (async () => ({ ok: true })),
      execBrowserJs: overrides.execBrowserJs ?? (async () => ({ ok: true, result: "" })),
    },
  };
}

describe("createBrowserBridge", () => {
  test("navigateはrpc.request.browserNavigateへtabId/urlをそのまま渡す", async () => {
    let received: unknown;
    const rpc = createFakeRpc({
      browserNavigate: async (p) => {
        received = p;
        return { ok: true };
      },
    });
    const bridge = createBrowserBridge(() => rpc);

    const result = await bridge.navigate("tab-1", "https://example.com");

    expect(result).toEqual({ ok: true });
    expect(received).toEqual({ tabId: "tab-1", url: "https://example.com" });
  });

  test("getTextはexecBrowserJsの結果（文字列）をtextとして返す", async () => {
    let receivedCode: unknown;
    const rpc = createFakeRpc({
      execBrowserJs: async (p) => {
        receivedCode = p.code;
        return { ok: true, result: "hello world" };
      },
    });
    const bridge = createBrowserBridge(() => rpc);

    const result = await bridge.getText("tab-1");

    expect(result).toEqual({ ok: true, text: "hello world" });
    expect(typeof receivedCode).toBe("string");
    expect(receivedCode).toContain("innerText");
  });

  test("getHtmlはexecBrowserJsの結果（文字列）をhtmlとして返す", async () => {
    const rpc = createFakeRpc({
      execBrowserJs: async () => ({ ok: true, result: "<html></html>" }),
    });
    const bridge = createBrowserBridge(() => rpc);

    const result = await bridge.getHtml("tab-1");

    expect(result).toEqual({ ok: true, html: "<html></html>" });
  });

  test("execBrowserJsの結果が文字列以外の場合はエラーを返す", async () => {
    const rpc = createFakeRpc({
      execBrowserJs: async () => ({ ok: true, result: 123 }),
    });
    const bridge = createBrowserBridge(() => rpc);

    const result = await bridge.getText("tab-1");

    expect(result.ok).toBe(false);
  });

  test("execBrowserJsが失敗した場合はそのままエラーを伝播する", async () => {
    const rpc = createFakeRpc({
      execBrowserJs: async () => ({ ok: false, error: "timed out" }),
    });
    const bridge = createBrowserBridge(() => rpc);

    expect(await bridge.getText("tab-1")).toEqual({ ok: false, error: "timed out" });
    expect(await bridge.getHtml("tab-1")).toEqual({ ok: false, error: "timed out" });
  });

  test("getUrlはexecBrowserJsの結果（文字列）をurlとして返す", async () => {
    let receivedCode: unknown;
    const rpc = createFakeRpc({
      execBrowserJs: async (p) => {
        receivedCode = p.code;
        return { ok: true, result: "https://example.com/" };
      },
    });
    const bridge = createBrowserBridge(() => rpc);

    const result = await bridge.getUrl("tab-1");

    expect(result).toEqual({ ok: true, url: "https://example.com/" });
    expect(typeof receivedCode).toBe("string");
    expect(receivedCode).toContain("document.location.href");
  });

  test("getRpcは呼び出し時（都度）に評価される（遅延アクセサとして機能する）", async () => {
    let rpcInstance: BrowserBridgeRpc | null = null;
    const bridge = createBrowserBridge(() => {
      if (!rpcInstance) throw new Error("rpc not ready yet");
      return rpcInstance;
    });

    rpcInstance = createFakeRpc();
    await expect(bridge.navigate("tab-1", "https://example.com")).resolves.toEqual({ ok: true });
  });
});
