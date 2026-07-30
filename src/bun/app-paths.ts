// niwatermのアプリケーションサポートディレクトリ（設定・永続化・IPCソケットの置き場所）の解決。

import { homedir } from "node:os";
import { join } from "node:path";

export function appSupportDir(): string {
  return join(homedir(), "Library", "Application Support", "niwaterm");
}
