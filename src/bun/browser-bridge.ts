// bunメインプロセスからブラウザタブ（OOPIF）を操作するための薄いラッパー。
// 実体はNiwaRPC.webview.requestsを経由してmainview側（src/mainview/index.ts）へ委譲する。
// rpcはsrc/bun/index.tsでこのモジュールより後（BrowserView.defineRPC呼び出し時）に初期化されるため、
// 実体ではなく遅延アクセサ（getRpc）を受け取る（getCustomView: () => customViewと同じパターン）。
import type { TabId } from "./tile-layout";

export type BrowserNavigateResult = { ok: true } | { ok: false; error: string };
export type BrowserGetTextResult = { ok: true; text: string } | { ok: false; error: string };
export type BrowserGetHtmlResult = { ok: true; html: string } | { ok: false; error: string };
export type BrowserGetUrlResult = { ok: true; url: string } | { ok: false; error: string };

export interface BrowserBridge {
  navigate(tabId: TabId, url: string): Promise<BrowserNavigateResult>;
  getText(tabId: TabId): Promise<BrowserGetTextResult>;
  getHtml(tabId: TabId): Promise<BrowserGetHtmlResult>;
  getUrl(tabId: TabId): Promise<BrowserGetUrlResult>;
}

/** mainview側へ渡すrpc.requestの最小構造インターフェース。NiwaRPCへの直接依存を避けるため */
export interface BrowserBridgeRpc {
  request: {
    browserNavigate(p: {
      tabId: TabId;
      url: string;
    }): Promise<{ ok: true } | { ok: false; error: string }>;
    execBrowserJs(p: {
      tabId: TabId;
      code: string;
    }): Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
  };
}

const GET_TEXT_CODE = "return document.body ? document.body.innerText : '';";
const GET_HTML_CODE = "return document.documentElement ? document.documentElement.outerHTML : '';";
const GET_URL_CODE = "return document.location.href;";

export function createBrowserBridge(getRpc: () => BrowserBridgeRpc): BrowserBridge {
  async function execText(
    tabId: TabId,
    code: string,
  ): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
    const r = await getRpc().request.execBrowserJs({ tabId, code });
    if (!r.ok) return r;
    if (typeof r.result !== "string") {
      return { ok: false, error: "unexpected result type from browser tab" };
    }
    return { ok: true, value: r.result };
  }

  return {
    navigate: (tabId, url) => getRpc().request.browserNavigate({ tabId, url }),
    async getText(tabId) {
      const r = await execText(tabId, GET_TEXT_CODE);
      return r.ok ? { ok: true, text: r.value } : r;
    },
    async getHtml(tabId) {
      const r = await execText(tabId, GET_HTML_CODE);
      return r.ok ? { ok: true, html: r.value } : r;
    },
    async getUrl(tabId) {
      const r = await execText(tabId, GET_URL_CODE);
      return r.ok ? { ok: true, url: r.value } : r;
    },
  };
}
