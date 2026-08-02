/**
 * ブラウザタブ（OOPIF）内でcodeを実行し、結果をhost-messageイベント経由でmainviewへ送り返すJSを組み立てる。
 * WebviewTagElement.executeJavascriptは戻り値を受け取れないfire-and-forgetのため、
 * ブラウザタブ内へ注入するJS自身に結果を送り返させる。ブラウザタブはsandbox属性付きで生成されており
 * window.__electrobunSendToHostはtrusted preload限定で使えないため、全webview（sandboxed含む）で
 * 利用可能なwindow.__electrobunEventBridgeへ直接postMessageする（emitWebviewEventと同じペイロード形）。
 */
export function buildExecBrowserJsScript(requestId: string, code: string): string {
  return `(async () => {
    const __rid = ${JSON.stringify(requestId)};
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
    try {
      const __result = await (async () => { ${code} })();
      let __safe;
      try {
        __safe = JSON.parse(JSON.stringify(__result === undefined ? null : __result));
      } catch (e) {
        __post({ requestId: __rid, ok: false, error: "result is not JSON-serializable" });
        return;
      }
      __post({ requestId: __rid, ok: true, result: __safe });
    } catch (err) {
      __post({ requestId: __rid, ok: false, error: (err && err.message) ? String(err.message) : String(err) });
    }
  })();`;
}
