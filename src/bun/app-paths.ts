// niwatermのアプリケーションサポートディレクトリ（設定・永続化・IPCソケットの置き場所）の解決。

import { homedir } from "node:os";
import { join } from "node:path";

export function appSupportDir(): string {
  if (process.platform === "win32") {
    // %APPDATA%はログオンセッションに必ず設定されるが、サービス起動等で欠ける場合に備えて既定値を持つ
    const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "niwaterm");
  }
  return join(homedir(), "Library", "Application Support", "niwaterm");
}
