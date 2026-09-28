import { subCommands } from "../commands";
import type { SourceKind } from "./sources";

/** gunshiのdefine()が返すコマンドのうち、補完設定の生成に必要な部分だけを見た形 */
export interface ArgSchemaLike {
  type: string;
  short?: string;
  choices?: readonly string[];
}

export interface CommandLike {
  args?: Record<string, ArgSchemaLike>;
  subCommands?: Record<string, CommandLike>;
}

/**
 * 引数名から引く候補の種類。CLIは「意味が対応する引数はコマンドをまたいで同じ名前」という
 * 命名規則（.agents/rules/cli-command-naming.md）に従うので、大半は名前だけで決まる。
 * 新しい値を取る引数を足したときは、ここか COMMAND_ARG_SOURCES へ追記しないと補完が効かない
 */
const ARG_SOURCES: Record<string, SourceKind> = {
  tab: "tabId",
  tile: "tileId",
  board: "boardId",
  workspace: "workspaceId",
  "to-workspace": "workspaceId",
  window: "windowId",
  shell: "shellProfile",
  preset: "layoutPreset",
  layout: "layoutPreset",
  view: "customView",
  open: "worktreeOpenMode",
  remote: "gitRemote",
  cwd: "directory",
  path: "directory",
  out: "filePath",
  config: "filePath",
  transcript: "filePath",
};

/**
 * コマンドごとの対応。ARG_SOURCESより優先する。
 * positionalは`layout apply <name>`・`docs show <name>`のように引数名がコマンド固有なので、
 * 名前だけでは引けずここで指定する
 */
const COMMAND_ARG_SOURCES: Record<string, Record<string, SourceKind>> = {
  "agent setup": { agent: "agentKind", cli: "cliName" },
  "board phase set": { phase: "boardPhase" },
  "docs show": { name: "docTopic" },
  "layout apply": { name: "layoutPreset" },
  "sidebar switch": { view: "sidebarView" },
  "worktree open": { worktree: "worktree" },
  "worktree remove": { worktree: "worktree" },
};

/** cli()へ渡すツリーそのもの。補完設定の生成に必要な形だけへ緩めて扱う */
const commandTree = subCommands as Record<string, CommandLike>;

/** 補完候補を出せる引数か。enumはコマンド定義のchoicesがそのまま候補になる */
export function argSource(fullName: string, argName: string): SourceKind | undefined {
  return COMMAND_ARG_SOURCES[fullName]?.[argName] ?? ARG_SOURCES[argName];
}

/** サブコマンドツリーを深さ優先で辿り、`tab var set`のような空白区切りの名前で返す */
export function* walkCommands(
  tree: Record<string, CommandLike> = commandTree,
  parentPath = "",
): Generator<{ fullName: string; command: CommandLike }> {
  for (const [name, command] of Object.entries(tree)) {
    const fullName = parentPath ? `${parentPath} ${name}` : name;
    yield { fullName, command };
    if (command.subCommands) yield* walkCommands(command.subCommands, fullName);
  }
}

function findCommand(words: string[]): { fullName: string; command: CommandLike } | null {
  let tree: Record<string, CommandLike> | undefined = commandTree;
  let command: CommandLike | null = null;
  const parts: string[] = [];
  for (const word of words) {
    // オプションとその値はコマンド名にならない。値はここでは判別できないが、
    // サブコマンド名と一致しない語を読み飛ばすだけで結果は変わらない
    if (word.startsWith("-")) continue;
    const next: CommandLike | undefined = tree?.[word];
    if (!next) continue;
    command = next;
    tree = next.subCommands;
    parts.push(word);
  }
  return command ? { fullName: parts.join(" "), command } : null;
}

function findArgByFlag(command: CommandLike, flag: string): [string, ArgSchemaLike] | undefined {
  const args = Object.entries(command.args ?? {});
  if (flag.startsWith("--")) {
    const name = flag.slice(2);
    return args.find(([argName]) => argName === name);
  }
  const short = flag.slice(1);
  return args.find(([, schema]) => schema.short === short);
}

/**
 * 補完しようとしている位置を読み、必要な候補の種類を割り出す。
 *
 * 判定を外しても余計な候補を読み込むか候補がゼロになるだけなので、`@bomb.sh/tab`が
 * 実際に補完を組み立てるときの解釈を厳密になぞってはいない。positionalは何個目を
 * 打っているかまでは見ず、そのコマンドのpositional全部を対象にする
 */
export function requiredSources(words: string[]): { kinds: Set<SourceKind>; current: string } {
  const kinds = new Set<SourceKind>();
  const raw = words.at(-1) ?? "";
  const before = words.slice(0, -1);
  const target = findCommand(before);
  if (!target) return { kinds, current: raw };

  // `--cwd=~/src`のように値まで1語で来る形。イコールの前がオプション名になる
  const equal = raw.startsWith("-") ? raw.indexOf("=") : -1;
  if (equal !== -1) {
    const source = flagSource(target, raw.slice(0, equal));
    if (source) kinds.add(source);
    return { kinds, current: raw.slice(equal + 1) };
  }
  // オプション名自体を打っている途中。値の候補は要らない
  if (raw.startsWith("-")) return { kinds, current: raw };

  const previous = before.at(-1) ?? "";
  if (previous.startsWith("-")) {
    const found = findArgByFlag(target.command, previous);
    // 真偽値のオプションは値を取らないので、その次の語はpositionalになる
    if (found && found[1].type !== "boolean") {
      const source = argSource(target.fullName, found[0]);
      if (source) kinds.add(source);
      return { kinds, current: raw };
    }
  }
  for (const [argName, schema] of Object.entries(target.command.args ?? {})) {
    if (schema.type !== "positional") continue;
    const source = argSource(target.fullName, argName);
    if (source) kinds.add(source);
  }
  return { kinds, current: raw };
}

function flagSource(
  target: { fullName: string; command: CommandLike },
  flag: string,
): SourceKind | undefined {
  const found = findArgByFlag(target.command, flag);
  return found ? argSource(target.fullName, found[0]) : undefined;
}
