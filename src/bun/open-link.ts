// OSC 8ハイパーリンク等、PTY越しの出力（リモートホスト由来を含む）に埋め込まれたURLを
// クリックで開く前のスキーム検証。file:/javascript:等の危険なスキームは開かず、
// 外部で開く用途として妥当なものだけ許可する
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function isAllowedLinkUrl(url: string): boolean {
  try {
    return ALLOWED_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
