import { failAndExit } from "./cli-error";
import {
  type BoardId,
  type IpcEndpoint,
  resolveTarget,
  type ResolvedTarget,
  type TabId,
  type TileId,
  type WorkspaceId,
} from "./ipc-client";
import { resolveWorkspaceQuery } from "./resolve-workspace";

/** コマンドラインで明示指定された対象ID。省略されたものはundefined */
export interface ExplicitTargetIds {
  tileId?: TileId;
  tabId?: TabId;
  boardId?: BoardId;
  workspaceId?: WorkspaceId;
}

export interface TargetResolver {
  tileId(): Promise<TileId>;
  tabId(): Promise<TabId>;
  boardId(): Promise<BoardId>;
  workspaceId(): Promise<WorkspaceId>;
}

/**
 * 省略された対象IDを「今の対象」で埋めるリゾルバを作る。起点は呼び出し元タブ
 * （niwatermがPTYへ注入するNIWATERM_TAB_ID）で、niwatermの外から叩かれた場合は
 * アクティブなワークスペースのフォーカス中タイル・アクティブタブへ落ちる。
 *
 * 明示指定された値は決して上書きしない。存在しないIDを渡された時に解決結果のIDへ
 * すり替わって別のタイル・タブを壊すのを防ぐためで、誤ったIDはそのまま操作側へ渡り
 * 「tile/tab not found」で弾かれる。ワークスペースだけは名前でも指定できるので、明示された値を
 * resolveWorkspaceQueryでIDへ引き直す（一致しなければフォールバックせず終了する）。
 * `--tab`が明示されている場合はそれを起点にするので、
 * `--tile`省略でも呼び出し元ではなく指定タブが居るタイルが埋まる。
 *
 * 問い合わせは実際に省略された項目を読んだ時だけ、1コマンドにつき1回だけ行う。
 * commandNameはエラー文言用のフルコマンド名（"tab close"等）。
 */
export function createTargetResolver(
  endpoint: IpcEndpoint,
  commandName: string,
  explicit: ExplicitTargetIds,
): TargetResolver {
  let pending: Promise<ResolvedTarget> | null = null;
  const fetchOnce = (): Promise<ResolvedTarget> => {
    pending ??= (async () => {
      const result = await resolveTarget(
        endpoint,
        explicit.tabId ?? process.env["NIWATERM_TAB_ID"],
      );
      if (!result.ok) {
        failAndExit(`${commandName}に失敗しました: ${result.error}`);
      }
      return result.target;
    })();
    return pending;
  };
  return {
    tileId: async () => explicit.tileId ?? (await fetchOnce()).tileId,
    tabId: async () => explicit.tabId ?? (await fetchOnce()).tabId,
    boardId: async () => explicit.boardId ?? (await fetchOnce()).boardId,
    workspaceId: async () =>
      explicit.workspaceId !== undefined
        ? await resolveWorkspaceQuery(endpoint, commandName, explicit.workspaceId)
        : (await fetchOnce()).workspaceId,
  };
}
