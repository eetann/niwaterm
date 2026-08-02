// Bun本体がv1.3.12以降ネイティブに提供するBun.WebView（headless専用、macOSはWKWebViewベース）を使い、
// 指定URLのスクリーンショットを取得する。niwatermの表示中ブラウザタブ（Electrobunの<electrobun-webview>）
// とは別インスタンスであるため、「今見えている状態そのもの」ではなく「同じURLを新規に開いた場合の見た目」になる。

export type ScreenshotResult = { ok: true; data: Blob } | { ok: false; error: string };

const NAVIGATE_TIMEOUT_MS = 15000;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

export async function captureUrlScreenshot(url: string): Promise<ScreenshotResult> {
  const view = new Bun.WebView({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
  try {
    await Promise.race([
      view.navigate(url),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("navigation timed out")), NAVIGATE_TIMEOUT_MS);
      }),
    ]);
    const data = await view.screenshot({ format: "png" });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    view.close();
  }
}
