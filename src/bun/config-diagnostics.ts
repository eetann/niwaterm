// 設定ファイルの読み込み・解決で見つかった不備の収集。
// config.tsのresolveXは不正な値をその項目だけ既定値へ落として残りを活かすが、落としたこと自体は
// console.logにしか出ておらず、GUIしか見ていないユーザーは「設定したのに効かない」としか分からない。
// ここへ集めた内容をConfigSummary経由で`niwaterm config show`・設定モーダルに載せる。

/** warnはその項目だけ既定値へ落ちた状態、errorはセクション単位で効いていない状態 */
export type ConfigDiagnosticLevel = "warn" | "error";

export interface ConfigDiagnostic {
  level: ConfigDiagnosticLevel;
  /** 設定ファイル上の位置。`appearance.fontSize`・`customViews[1].path`のようにドット区切りで書く */
  scope: string;
  message: string;
}

export interface ConfigDiagnostics {
  /** その項目だけ既定値へ落としたときに使う */
  warn(scope: string, message: string): void;
  /** セクション単位で効かなくなったときに使う（ユーザー関数の例外・ファイル読み込み失敗） */
  error(scope: string, message: string): void;
  list(): ConfigDiagnostic[];
}

/**
 * 収集先を用意する。同じ内容をconsole.logへも流す（ターミナルで追っている時の手がかりを
 * 残すため）。収集した配列は解決1回ぶんで、ホットリロードのたびに新しく作り直す。
 */
export function createConfigDiagnostics(): ConfigDiagnostics {
  const items: ConfigDiagnostic[] = [];

  function push(level: ConfigDiagnosticLevel, scope: string, message: string): void {
    items.push({ level, scope, message });
    console.log(`[bun] config ${level}: ${scope}: ${message}`);
  }

  return {
    warn: (scope, message) => push("warn", scope, message),
    error: (scope, message) => push("error", scope, message),
    list: () => [...items],
  };
}

/** 不正値をそのまま埋め込むと`[object Object]`になる型があるため、JSON化できるものはJSONで出す */
export function describeValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "function") return "(関数)";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
