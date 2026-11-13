import { failAndExit } from "./cli-error";
import {
  type IpcEndpoint,
  listWorkspaces,
  type WorkspaceId,
  type WorkspaceListEntry,
} from "./ipc-client";

export type WorkspaceMatch =
  | { kind: "found"; workspaceId: WorkspaceId }
  | { kind: "not-found" }
  | { kind: "ambiguous"; candidates: WorkspaceListEntry[] };

/**
 * `--workspace`の値をworkspaceIdか名前として照合する。
 * ID完全一致→名前完全一致→名前の部分一致（大文字小文字を区別しない）の順に見る。
 * 部分一致が複数なら選ばずに候補を返す。最初の1つを採ると、別のワークスペースへ
 * Boardを作る・閉じるといった操作が黙って通ってしまうため
 */
export function matchWorkspace(workspaces: WorkspaceListEntry[], query: string): WorkspaceMatch {
  const byId = workspaces.find((w) => w.workspaceId === query);
  if (byId) return { kind: "found", workspaceId: byId.workspaceId };
  const byName = workspaces.filter((w) => w.name === query);
  if (byName.length === 1 && byName[0])
    return { kind: "found", workspaceId: byName[0].workspaceId };
  if (byName.length > 1) return { kind: "ambiguous", candidates: byName };

  const needle = query.toLowerCase();
  const partial = workspaces.filter((w) => w.name?.toLowerCase().includes(needle) === true);
  if (partial.length === 1 && partial[0]) {
    return { kind: "found", workspaceId: partial[0].workspaceId };
  }
  if (partial.length > 1) return { kind: "ambiguous", candidates: partial };
  return { kind: "not-found" };
}

function formatCandidates(workspaces: WorkspaceListEntry[]): string {
  return workspaces
    .map((w) => `  ${w.workspaceId}${w.name !== null ? ` ${w.name}` : ""}`)
    .join("\n");
}

/**
 * `--workspace`に渡された値（IDか名前の一部）をworkspaceIdへ解決する。
 * 見つからない・複数に当たる場合は候補を並べて終了する。
 * commandNameはエラー文言用のフルコマンド名（"worktree new"等）
 */
export async function resolveWorkspaceQuery(
  endpoint: IpcEndpoint,
  commandName: string,
  query: string,
): Promise<WorkspaceId> {
  const list = await listWorkspaces(endpoint);
  if (!list.ok) failAndExit(`${commandName}に失敗しました: ${list.error}`);
  const match = matchWorkspace(list.workspaces, query);
  if (match.kind === "found") return match.workspaceId;
  if (match.kind === "ambiguous") {
    failAndExit(
      `${commandName}に失敗しました: ${query}に一致するワークスペースが複数あります。IDか、より長い名前で指定してください:\n${formatCandidates(match.candidates)}`,
    );
  }
  failAndExit(
    `${commandName}に失敗しました: ${query}に一致するワークスペースがありません:\n${formatCandidates(list.workspaces)}`,
  );
}
