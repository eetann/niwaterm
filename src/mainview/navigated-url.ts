/**
 * did-navigateのdetailは、プラットフォーム（WebView2/CEF/WKWebView）によって
 * プレーンなURL文字列の場合とJSON文字列 `{"url": "..."}` の場合がある
 * （Windows実機で後者を確認済み）。両方に対応する。
 */
export function extractNavigatedUrl(detail: unknown): string {
  if (typeof detail !== "string") return "";
  try {
    const parsed: unknown = JSON.parse(detail);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { url?: unknown }).url === "string"
    ) {
      return (parsed as { url: string }).url;
    }
  } catch {
    // JSONでなければプレーンなURL文字列としてそのまま扱う
  }
  return detail;
}
