import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import claudeHooks from "../../../contrib/agent-integration/claude-code/hooks.json";
import codexHooks from "../../../contrib/agent-integration/codex-cli/hooks.json";
import type { Agent } from "./agent-hook";

type Handler = { command?: string; [key: string]: unknown };
type Group = { hooks: Handler[]; [key: string]: unknown };
type Config = { hooks?: Record<string, Group[]>; [key: string]: unknown };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateConfig(value: unknown): asserts value is Config {
  if (!isObject(value)) throw new Error("設定のルートはJSONオブジェクトである必要があります");
  if (value.hooks === undefined) return;
  if (!isObject(value.hooks)) throw new Error("hooksはJSONオブジェクトである必要があります");
  for (const groups of Object.values(value.hooks)) {
    if (!Array.isArray(groups)) throw new Error("hookイベントの設定は配列である必要があります");
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks) || !group.hooks.every(isObject)) {
        throw new Error("hookのmatcherグループまたはhandlerが不正です");
      }
    }
  }
}

// `niwaterm`はCLIの旧コマンド名。それで導入済みのhooksも`agent setup`の再実行で置き換えられるよう一致させる
function isNiwatermHook(handler: Handler): boolean {
  if (typeof handler.command !== "string") return false;
  return (
    /\bniwa(?:term)?(?:-dev)?\s+_hook\s+(?:claude-code|codex-cli)\b/.test(handler.command) ||
    (handler.command.includes("NIWATERM_TAB_ID") &&
      /(?:niwa(?:term)?(?:-dev)?\s+tab\s+var\s+set\s+agent(?:_status(?:_text)?)?\s|\$niwa_cli)/.test(
        handler.command,
      ))
  );
}

export function mergeAgentHooks(current: unknown, agent: Agent, cli: "niwa" | "niwa-dev"): Config {
  validateConfig(current);
  const merged = structuredClone(current);
  const hooks = merged.hooks ?? {};
  for (const [event, groups] of Object.entries(hooks)) {
    hooks[event] = groups
      .map((group) => ({
        ...group,
        hooks: group.hooks.filter((handler) => !isNiwatermHook(handler)),
      }))
      .filter((group) => group.hooks.length > 0);
  }
  const template = agent === "codex-cli" ? codexHooks : claudeHooks;
  for (const [event, groups] of Object.entries(template.hooks)) {
    const entries = structuredClone(groups);
    for (const group of entries) {
      for (const handler of group.hooks) {
        handler.command = handler.command.replace(/^niwa /, `${cli} `);
      }
    }
    hooks[event] = [...(hooks[event] ?? []), ...entries];
  }
  return { ...merged, hooks };
}

export function agentConfigPath(agent: Agent): string {
  return agent === "codex-cli"
    ? join(process.env["CODEX_HOME"] || join(homedir(), ".codex"), "hooks.json")
    : join(process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude"), "settings.json");
}

export async function setupAgent(agent: Agent, path: string, cli: "niwa" | "niwa-dev") {
  let target = resolve(path);
  let original: string | undefined;
  let mode = 0o600;
  try {
    target = await realpath(target);
    original = await readFile(target, "utf8");
    mode = (await stat(target)).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const entry = await lstat(target).catch((statError: NodeJS.ErrnoException) => {
      if (statError.code !== "ENOENT") throw statError;
      return undefined;
    });
    if (entry?.isSymbolicLink()) throw new Error("設定先のシンボリックリンクが切れています");
  }
  const output = `${JSON.stringify(mergeAgentHooks(original === undefined ? {} : JSON.parse(original), agent, cli), null, 2)}\n`;
  if (output === original) return { path: target, changed: false };
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.niwaterm-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, output, { flag: "wx", mode });
    if (original !== undefined) {
      // マージ中に設定が更新された場合、その変更を失わないように再実行を促す。
      if ((await readFile(target, "utf8")) !== original)
        throw new Error("設定が更新されました。再実行してください");
      await copyFile(target, `${target}.niwaterm-${randomUUID()}.bak`);
    }
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return { path: target, changed: true };
}
