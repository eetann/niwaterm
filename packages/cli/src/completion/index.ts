import type { CompletionOptions } from "@gunshi/plugin-completion";
import { type ArgSchemaLike, argSource, requiredSources, walkCommands } from "./mapping";
import { pathCompletions } from "./paths";
import { type CompletionItem, loadSources, PATH_SOURCES, type SourceMap } from "./sources";

type CompletionConfig = NonNullable<CompletionOptions["config"]>;

/** `complete <shell>`で補完スクリプトを出力できるシェル（@bomb.sh/tabの対応範囲） */
export const COMPLETION_SHELLS = new Set(["bash", "zsh", "fish", "powershell"]);

/** 補完候補を組み立てるハンドラ。`@gunshi/plugin-completion`の仕様で同期でなければならない */
function createHandler(
  fullName: string,
  argName: string,
  schema: ArgSchemaLike,
  sources: SourceMap,
  current: string,
): (() => CompletionItem[]) | undefined {
  if (schema.choices) {
    const items = schema.choices.map((choice) => ({ value: choice }));
    return () => items;
  }
  const kind = argSource(fullName, argName);
  if (!kind) return undefined;
  if (PATH_SOURCES.has(kind)) return () => pathCompletions(current, kind === "directory");
  const items = sources.get(kind);
  return items ? () => items : undefined;
}

/**
 * 補完候補の設定を組み立てる。
 *
 * ハンドラは同期でしか呼ばれないため、起動中のniwatermへの問い合わせはここで済ませて
 * 結果をハンドラへ閉じ込める。補完が要求されていない通常の実行（`niwa tab new`など）では
 * 問い合わせが起きないよう、`complete -- ...`の形の呼び出しでだけ読み込む
 */
export async function buildCompletionConfig(argv: string[]): Promise<CompletionConfig> {
  const terminator = argv.indexOf("--");
  if (argv[0] !== "complete" || terminator === -1) return {};
  const { kinds, current } = requiredSources(argv.slice(terminator + 1));
  const sources = await loadSources(kinds);
  const subCommands: NonNullable<CompletionConfig["subCommands"]> = {};
  for (const { fullName, command } of walkCommands()) {
    const args: Record<string, { handler: () => CompletionItem[] }> = {};
    for (const [argName, schema] of Object.entries(command.args ?? {})) {
      const handler = createHandler(fullName, argName, schema, sources, current);
      if (handler) args[argName] = { handler };
    }
    if (Object.keys(args).length > 0) subCommands[fullName] = { args };
  }
  return { subCommands };
}
