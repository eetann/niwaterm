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

/**
 * niwaterm内のブラウザタブで開けるURLか。mailto:はOS側のメールクライアントへ渡すものなので、
 * link.openがbrowser-tabでも外部で開く必要がある
 */
export function isBrowserTabUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
