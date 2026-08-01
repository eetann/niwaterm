// ブラウザタブのURL入力欄でスキーム省略時（例: "example.com"）にhttps://を補う。
// "localhost:3000"のような「ホスト:ポート」をスキーム付きURLと誤検出しないよう、
// スキーム判定は「://を伴う」か「about:」に限定する
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("about:") || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}
