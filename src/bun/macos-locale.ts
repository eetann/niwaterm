import { existsSync } from "node:fs";

const FALLBACK_LANG = "en_US.UTF-8";

/**
 * macOSの言語・地域設定（`AppleLocale`、例: `ja_JP`・`en_JP`・`ja_JP@calendar=japanese`）から
 * タブのシェルへ渡す`LANG`を決める。言語と地域の組み合わせによっては対応するPOSIXロケールが
 * 存在しない（`en_JP`等）ため、`/usr/share/locale`に実在するものだけを採用し、無ければ
 * `en_US.UTF-8`へ落とす。文字化けを防ぐのが目的なので、エンコーディングは常にUTF-8にする。
 */
export function langFromAppleLocale(
  appleLocale: string | undefined,
  localeExists: (name: string) => boolean,
): string {
  const base = appleLocale?.trim().split("@")[0];
  if (!base) return FALLBACK_LANG;
  const candidate = `${base}.UTF-8`;
  return localeExists(candidate) ? candidate : FALLBACK_LANG;
}

let cachedLang: string | undefined;

/** macOSの言語・地域設定に合わせた`LANG`。初回だけ`defaults`を呼び、以降は使い回す */
export function defaultMacLang(): string {
  if (cachedLang) return cachedLang;
  let appleLocale: string | undefined;
  try {
    const result = Bun.spawnSync(["defaults", "read", "-g", "AppleLocale"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode === 0) appleLocale = result.stdout.toString();
  } catch {
    // defaultsが呼べない環境では既定値へ落とす
  }
  cachedLang = langFromAppleLocale(appleLocale, (name) => existsSync(`/usr/share/locale/${name}`));
  return cachedLang;
}

const LOCALE_ENV_KEYS = ["LANG", "LC_ALL", "LC_CTYPE"];

/**
 * ロケール変数が1つも無いときだけ`LANG`を補う。Finder・Dockから起動した.appは
 * ログインシェルを経由しないためロケール変数を持たず、そのままタブへ渡すと
 * `ls`等が非ASCIIのファイル名を`?`に置き換えて表示する。
 * ユーザーが設定済みの値は尊重し、`LC_*`で上書きできるよう`LC_ALL`ではなく`LANG`を使う。
 */
export function fillMissingLocale(env: Record<string, string>, lang: string): void {
  if (LOCALE_ENV_KEYS.some((key) => env[key])) return;
  env["LANG"] = lang;
}
