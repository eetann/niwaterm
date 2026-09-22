/**
 * customViewのHTML（OOPIF）内へ注入する`window.niwaterm`の実装と、その呼び出しの受け渡し。
 * customViewは他のブラウザタブと同じsandbox属性付き<electrobun-webview>で読み込まれるため
 * trusted preloadでのAPI注入は使えない。dom-ready後にブートストラップスクリプトを
 * executeJavascriptで流し込み、呼び出しはwindow.__electrobunEventBridge経由のhost-messageで
 * 受け取る（browser-js-bridge.tsと同じ経路）。
 */

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** customViewのHTMLへ渡す、niwatermの配色。HTML側がサイドバーへ馴染む見た目を作れるようにする */
export interface CustomViewTheme {
  background: string;
  foreground: string;
}

/** HTML側の`niwaterm.call(name, payload)`1回分 */
export interface CustomViewCallMessage {
  callId: string;
  name: string;
  payload: unknown;
}

/** HTML側のPromiseを解決する値。bun側のCustomViewCallResultをそのまま渡す */
export type CustomViewCallResultPayload =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

/**
 * JSONを式としてスクリプトへ埋め込む。U+2028/U+2029はJSON上は生のまま出るがJSでは行終端扱いになり、
 * そのまま埋め込むと構文エラーになる（ハンドラの戻り値にはgitの出力等、任意のテキストが入りうる）
 */
function jsLiteral(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * customViewのHTML内で`window.niwaterm`を定義する。既に定義済みなら呼べるハンドラ名だけを
 * 差し替える（設定のホットリロードでhandlersが変わっても、HTML側の保留中の呼び出しを壊さないため）。
 * 定義し終えた合図として`niwaterm:ready`イベントを投げる。注入はdom-ready後になるため、
 * HTML側のスクリプトは`window.niwaterm`の有無を見てからこのイベントを待つ。
 * 2回目以降（設定のホットリロード）は`niwaterm:theme`を投げ、HTML側が配色へ追従できるようにする
 */
export function buildCustomViewBootstrapScript(
  handlerNames: string[],
  theme: CustomViewTheme,
): string {
  return `(() => {
    const __names = ${jsLiteral(handlerNames)};
    const __theme = ${jsLiteral(theme)};
    if (window.niwaterm) {
      window.niwaterm.handlers = __names;
      window.niwaterm.theme = __theme;
      window.dispatchEvent(new Event("niwaterm:theme"));
      return;
    }
    const __pending = new Map();
    let __seq = 0;
    const __post = (payload) => {
      const bridge = window.__electrobunEventBridge || window.__electrobunInternalBridge;
      if (!bridge) return;
      // setTimeoutで包むのはBun FFIとの競合状態を避けるためのworkaround
      // （electrobun本体のemitWebviewEvent実装と同じ理由・同じ書き方）
      setTimeout(() => {
        try {
          bridge.postMessage(JSON.stringify({
            id: "webviewEvent",
            type: "message",
            payload: {
              id: window.__electrobunWebviewId,
              eventName: "host-message",
              detail: JSON.stringify(payload),
            },
          }));
        } catch (e) {}
      });
    };
    window.__niwatermResolveCall = (callId, res) => {
      const entry = __pending.get(callId);
      if (!entry) return;
      __pending.delete(callId);
      if (res && res.ok) entry.resolve(res.result);
      else entry.reject(new Error((res && res.error) || "customView call failed"));
    };
    window.niwaterm = {
      handlers: __names,
      theme: __theme,
      call(name, payload) {
        return new Promise((resolve, reject) => {
          // webviewIdを混ぜるのは、複数ウィンドウのcustomViewが同時に呼んでもcallIdが衝突しないようにするため
          // （結果は全ウィンドウへ配られ、自分が出したcallIdだけを拾う）
          const callId = "cv-" + (window.__electrobunWebviewId ?? "x") + "-" + ++__seq;
          __pending.set(callId, { resolve, reject });
          __post({ niwatermCall: { callId, name, payload: payload === undefined ? null : payload } });
        });
      },
    };
    window.dispatchEvent(new Event("niwaterm:ready"));
  })();`;
}

/** 保留中の`niwaterm.call`のPromiseを解決する */
export function buildCustomViewResolveScript(
  callId: string,
  result: CustomViewCallResultPayload,
): string {
  return `window.__niwatermResolveCall && window.__niwatermResolveCall(${jsLiteral(callId)}, ${jsLiteral(result)});`;
}

/** host-messageのdetailが`niwaterm.call`のものならその内容を返す。他のhost-message（execBrowserJsの結果等）はnull */
export function parseCustomViewCallMessage(detail: unknown): CustomViewCallMessage | null {
  // detailはJSON文字列のまま届くこともある（host-messageのdetailの形はプラットフォーム依存）
  const value = typeof detail === "string" ? safeJsonParse(detail) : detail;
  if (typeof value !== "object" || value === null) return null;
  const call = (value as { niwatermCall?: unknown }).niwatermCall;
  if (typeof call !== "object" || call === null) return null;
  const { callId, name, payload } = call as Record<string, unknown>;
  if (typeof callId !== "string" || typeof name !== "string") return null;
  return { callId, name, payload: payload ?? null };
}
