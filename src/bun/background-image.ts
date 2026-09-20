// appearance.backgroundImageをwebviewへ渡せるCSSのbackground-image値へ変換する。
import { readFileSync } from "node:fs";
import { extname } from "node:path";

/** CSSのbackground-imageとして既に成立している値かの判定に使う先頭トークン */
const CSS_VALUE_PREFIXES = [
  "none",
  "url(",
  "image-set(",
  "-webkit-image-set(",
  "linear-gradient(",
  "radial-gradient(",
  "conic-gradient(",
  "repeating-linear-gradient(",
  "repeating-radial-gradient(",
  "repeating-conic-gradient(",
];

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

function isCssValue(value: string): boolean {
  const lowered = value.toLowerCase();
  return CSS_VALUE_PREFIXES.some((prefix) => lowered.startsWith(prefix));
}

/**
 * 設定値をCSSのbackground-image値へ解決する。CSSの関数形式ならそのまま通し、
 * それ以外はローカルの画像ファイルパスとみなしてdata URIへ埋め込む。
 * webviewはviews://スキームで動いており、任意のローカルパスをそのままURLとして読めないため。
 * 読めない・対応外の拡張子なら警告して"none"を返す（背景が出ないだけで起動は続行する）
 */
export function resolveBackgroundImage(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "none";
  if (isCssValue(trimmed)) return trimmed;

  const mime = MIME_BY_EXTENSION[extname(trimmed).toLowerCase()];
  if (!mime) {
    console.log(`[bun] unsupported appearance.backgroundImage extension: ${trimmed}`);
    return "none";
  }

  try {
    const base64 = readFileSync(trimmed).toString("base64");
    return `url("data:${mime};base64,${base64}")`;
  } catch (err: unknown) {
    console.log(`[bun] failed to read appearance.backgroundImage (${trimmed}): ${String(err)}`);
    return "none";
  }
}
