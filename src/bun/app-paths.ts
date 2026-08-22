// niwatermのアプリケーションサポートディレクトリ（設定・永続化・IPCソケットの置き場所）の解決。
// 開発中ビルド(niwaterm-dev)と普段遣いビルド(niwaterm-daily-dev、NIWATERM_APP_NAME環境変数で
// アプリ名を変えて起動する。electrobun.config.ts参照)を同時に動かしても設定・IPCソケットが
// 衝突しないよう、実際に使われたアプリ名(APP_VARIANT)別にディレクトリを分ける。

import { homedir } from "node:os";
import { join } from "node:path";
import { APP_VARIANT } from "./app-variant.generated";

export function appSupportDir(): string {
  if (process.platform === "win32") {
    // %APPDATA%はログオンセッションに必ず設定されるが、サービス起動等で欠ける場合に備えて既定値を持つ
    const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    return join(appData, APP_VARIANT);
  }
  return join(homedir(), "Library", "Application Support", APP_VARIANT);
}
