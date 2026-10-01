import { AGENTS } from "../agent-hook";
import { loadTopics } from "../commands/docs";
import {
  type BoardListEntry,
  type IpcEndpoint,
  listLayouts,
  listShellProfiles,
  listWindows,
  listWorkspaces,
  resolveIpcEndpoint,
  setIpcTimeoutMs,
  showConfig,
  type TileLeafSummary,
  type TileSummary,
  type WorkspaceListEntry,
} from "../ipc-client";
import { WORKTREE_OPEN_MODES } from "../worktree/config";
import { listRemotes, listWorktrees } from "../worktree/git";

/**
 * 補完候補の種類。CLIの引数名との対応はmapping.tsが持つ。
 * パス系（directory・filePath）だけは入力中の文字列から同期的にファイルシステムを引くため、
 * ここでの読み込み対象には含まれない
 */
export type SourceKind =
  | "tabId"
  | "tileId"
  | "boardId"
  | "workspaceId"
  | "windowId"
  | "shellProfile"
  | "layoutPreset"
  | "customView"
  | "sidebarView"
  | "boardPhase"
  | "statusBarItem"
  | "docTopic"
  | "worktree"
  | "gitRemote"
  | "worktreeOpenMode"
  | "agentKind"
  | "cliName"
  | "directory"
  | "filePath";

/** ファイルシステムから同期的に引く種類。読み込み（loadSources）の対象外 */
export const PATH_SOURCES = new Set<SourceKind>(["directory", "filePath"]);

export interface CompletionItem {
  value: string;
  description?: string;
}

export type SourceMap = Map<SourceKind, CompletionItem[]>;

/**
 * 補完のためのIPCに許す待ち時間。アプリが起動していれば数ミリ秒で返るため、ここへ達するのは
 * 事実上アプリが落ちている場合だけ。長くすると候補ゼロが確定している場面でタブキーが固まる
 */
const COMPLETION_IPC_TIMEOUT_MS = 600;

/** ワークスペース一覧1回で賄える種類 */
const FROM_WORKSPACES: SourceKind[] = ["tabId", "tileId", "boardId", "workspaceId"];

/** 設定の読み出し1回で賄える種類 */
const FROM_CONFIG: SourceKind[] = ["customView", "sidebarView", "boardPhase", "statusBarItem"];

/** 起動中のniwatermへ問い合わせないと分からない種類 */
const FROM_IPC = new Set<SourceKind>([
  ...FROM_WORKSPACES,
  ...FROM_CONFIG,
  "windowId",
  "shellProfile",
  "layoutPreset",
]);

/** サイドバーのビュー切替でだけ選べる、customViewではない組み込みのビュー */
const WORKSPACES_VIEW: CompletionItem = { value: "workspaces", description: "ワークスペース一覧" };

function boardLabel(board: BoardListEntry): string {
  return board.name ?? board.autoName ?? board.boardId;
}

function workspaceLabel(workspace: WorkspaceListEntry): string {
  return workspace.name ?? workspace.workspaceId;
}

/** タイル木を深さ優先で辿る。leafだけが操作対象になるのでsplitは畳んで返さない */
function* leafTiles(tile: TileSummary): Generator<TileLeafSummary> {
  if (tile.kind === "leaf") {
    yield tile;
    return;
  }
  yield* leafTiles(tile.first);
  yield* leafTiles(tile.second);
}

/**
 * ワークスペース一覧から、IDを引数に取る4種類の候補をまとめて作る。
 * IDは`tab-3`のような機械的な文字列で、それ単体ではどれを指すのか分からないため、
 * 説明にはワークスペース・Boardの名前など「画面を見れば分かる情報」を添える
 */
export function fromWorkspaces(workspaces: WorkspaceListEntry[]): SourceMap {
  const tabs: CompletionItem[] = [];
  const tiles: CompletionItem[] = [];
  const boards: CompletionItem[] = [];
  const spaces: CompletionItem[] = [];
  for (const workspace of workspaces) {
    const wsName = workspaceLabel(workspace);
    spaces.push({
      value: workspace.workspaceId,
      description: `${wsName}${workspace.active ? " (active)" : ""}`,
    });
    for (const board of workspace.boards) {
      const bdName = boardLabel(board);
      boards.push({
        value: board.boardId,
        description: `${bdName} @${wsName}${board.active ? " (active)" : ""}`,
      });
      for (const tile of leafTiles(board.layout)) {
        tiles.push({
          value: tile.id,
          description: `${bdName} @${wsName}${tile.id === board.focusedTileId ? " (focused)" : ""}`,
        });
        for (const tabId of tile.tabIds) {
          tabs.push({
            value: tabId,
            description: `${bdName} @${wsName}${tabId === tile.activeTabId ? " (active)" : ""}`,
          });
        }
      }
    }
  }
  return new Map([
    ["tabId", tabs],
    ["tileId", tiles],
    ["boardId", boards],
    ["workspaceId", spaces],
  ] satisfies [SourceKind, CompletionItem[]][]);
}

/**
 * 設定の要約からビュー・フェーズ・ステータスバーの部品の候補を作る。
 * customViewsのエントリはキーがそのままidだが、1つも定義が無いときだけ
 * `views`という別のキーでプレースホルダが入る（src/bun/config-summary.ts）ので取り除く
 */
export function fromConfig(
  sections: { name: string; entries: { key: string; value: string }[] }[],
): SourceMap {
  const customViews = (sections.find((section) => section.name === "customViews")?.entries ?? [])
    .filter((entry) => entry.key !== "views")
    // 値は`表示名 (URL)`の形。URLは補完候補の説明としては長すぎるので表示名だけ使う
    .map((entry) => ({ value: entry.key, description: entry.value.split(" (")[0] }));
  const phaseValue =
    sections
      .find((section) => section.name === "board")
      ?.entries.find((entry) => entry.key === "phases")?.value ?? "";
  // 1つも定義が無いフェーズはid列ではなく"(なし)"という表示用の文字列で来る
  const phases =
    phaseValue === "(なし)"
      ? []
      : phaseValue
          .split(",")
          .map((phase) => ({ value: phase.trim() }))
          .filter((phase) => phase.value !== "");
  // ステータスバーも部品のidがキー。出さない設定のときだけ"(なし)"のプレースホルダが1件入る
  const statusBarItems = (sections.find((section) => section.name === "statusBar")?.entries ?? [])
    .filter((entry) => entry.value !== "(なし)")
    .map((entry) => ({ value: entry.key, description: entry.value }));
  return new Map([
    ["customView", customViews],
    ["sidebarView", [...customViews, WORKSPACES_VIEW]],
    ["boardPhase", phases],
    ["statusBarItem", statusBarItems],
  ] satisfies [SourceKind, CompletionItem[]][]);
}

function constantSource(kind: SourceKind): CompletionItem[] | null {
  switch (kind) {
    case "worktreeOpenMode":
      return WORKTREE_OPEN_MODES.map((mode) => ({ value: mode }));
    case "agentKind":
      return AGENTS.map((agent) => ({ value: agent }));
    case "cliName":
      return [
        { value: "niwa", description: "普段遣いのインスタンス" },
        { value: "niwa-dev", description: "開発中のインスタンス" },
      ];
    default:
      return null;
  }
}

async function loadWorktrees(): Promise<CompletionItem[]> {
  const result = await listWorktrees(process.cwd());
  if (!result.ok) return [];
  // `worktree open`・`worktree remove`はブランチ名でもパスでも引ける（worktree/git.tsの
  // findWorktreeByQuery）。打つのが短いブランチ名を候補にし、detachedのものだけパスで出す
  return result.worktrees.map((worktree) => ({
    value: worktree.branch ?? worktree.path,
    description: worktree.branch ? worktree.path : "(detached)",
  }));
}

async function loadDocTopics(): Promise<CompletionItem[]> {
  try {
    return (await loadTopics()).map((topic) => ({
      value: topic.name,
      description: topic.description,
    }));
  } catch {
    return [];
  }
}

function loadFromIpc(
  kinds: Set<SourceKind>,
  endpoint: IpcEndpoint,
  into: SourceMap,
): Promise<void>[] {
  const tasks: Promise<void>[] = [];
  const merge = (map: SourceMap) => {
    for (const [kind, items] of map) if (kinds.has(kind)) into.set(kind, items);
  };
  if (FROM_WORKSPACES.some((kind) => kinds.has(kind))) {
    tasks.push(
      listWorkspaces(endpoint).then((result) => {
        if (result.ok) merge(fromWorkspaces(result.workspaces));
      }),
    );
  }
  if (FROM_CONFIG.some((kind) => kinds.has(kind))) {
    tasks.push(
      showConfig(endpoint).then((result) => {
        if (result.ok) merge(fromConfig(result.sections));
      }),
    );
  }
  if (kinds.has("windowId")) {
    tasks.push(
      listWindows(endpoint).then((result) => {
        if (!result.ok) return;
        into.set(
          "windowId",
          result.windows.map((window) => ({
            value: window.windowId,
            description: `${window.workspaceIds.length}ワークスペース${window.focused ? " (focused)" : ""}`,
          })),
        );
      }),
    );
  }
  if (kinds.has("shellProfile")) {
    tasks.push(
      listShellProfiles(endpoint).then((result) => {
        if (!result.ok) return;
        into.set(
          "shellProfile",
          result.profiles.map((profile) => ({ value: profile.id, description: profile.name })),
        );
      }),
    );
  }
  if (kinds.has("layoutPreset")) {
    tasks.push(
      // プロジェクトローカルのプリセット（.niwaterm/config.ts）も候補に入れるため、
      // 補完を走らせたディレクトリを解決の起点として渡す
      listLayouts(endpoint, process.cwd()).then((result) => {
        if (!result.ok) return;
        into.set(
          "layoutPreset",
          result.layouts.map((layout) => ({
            value: layout.name,
            description: layout.description ?? (layout.builtin ? "(builtin)" : ""),
          })),
        );
      }),
    );
  }
  return tasks;
}

/**
 * 補完に必要な候補だけを読み込む。
 * どこから読むかで失敗の仕方が違う（アプリ未起動・gitリポジトリ外など）が、補完中に
 * エラーを出しても候補欄が汚れるだけなので、取れなかった種類は黙って候補ゼロにする
 */
export async function loadSources(kinds: Set<SourceKind>): Promise<SourceMap> {
  const sources: SourceMap = new Map();
  const tasks: Promise<void>[] = [];
  for (const kind of kinds) {
    const constants = constantSource(kind);
    if (constants) sources.set(kind, constants);
  }
  if (kinds.has("docTopic")) {
    tasks.push(loadDocTopics().then((items) => void sources.set("docTopic", items)));
  }
  if (kinds.has("worktree")) {
    tasks.push(loadWorktrees().then((items) => void sources.set("worktree", items)));
  }
  if (kinds.has("gitRemote")) {
    tasks.push(
      listRemotes(process.cwd()).then((remotes) => {
        sources.set(
          "gitRemote",
          remotes.map((remote) => ({ value: remote })),
        );
      }),
    );
  }
  if ([...kinds].some((kind) => FROM_IPC.has(kind))) {
    setIpcTimeoutMs(COMPLETION_IPC_TIMEOUT_MS);
    tasks.push(...loadFromIpc(kinds, resolveIpcEndpoint(), sources));
  }
  await Promise.all(tasks);
  return sources;
}
