// customViewのhandlers（HTML側のniwaterm.callで呼ばれる関数）の実行。
// ユーザー設定の関数はbun側でしか呼べないため、webviewへは名前だけを渡し
// （ResolvedCustomViewConfig.handlerNames）、呼び出し時に名前から実体を引く
// （mouse.selectionMenuのSelectionMenuEntryと同じ方式）。
// ハンドラ名はcustomViewごとに独立しているため、名前を引く前にまずビューのidで絞る。

import type { CustomViewHandlers, Niwa } from "@niwaterm/config";

export type CustomViewCallResult = { ok: true; result: unknown } | { ok: false; error: string };

/** customViewのid → そのビューのhandlers */
export type CustomViewHandlersById = Record<string, CustomViewHandlers>;

export interface CustomViewHandlersHandle {
  /**
   * HTML側のniwaterm.callから呼ぶ。未知のビューid・未定義の名前・ハンドラ内の例外・
   * JSONにできない戻り値はエラーを返す
   */
  run(viewId: string, name: string, payload: unknown): Promise<CustomViewCallResult>;
}

export function createCustomViewHandlers(
  handlersById: CustomViewHandlersById,
  niwa: Niwa,
): CustomViewHandlersHandle {
  return {
    async run(viewId, name, payload) {
      const handler = handlersById[viewId]?.[name];
      if (!handler) {
        return { ok: false, error: `customView handler not found: ${viewId}.${name}` };
      }
      let result: unknown;
      try {
        result = await handler(payload, niwa);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // 戻り値はwebviewへJSON文字列で渡るため、ここで変換できるかを確かめてから返す
      // （関数・循環参照はJSON.stringifyで落ちる。undefinedはJSONに無いのでnullへ寄せる）
      try {
        return { ok: true, result: JSON.parse(JSON.stringify(result ?? null)) };
      } catch {
        return {
          ok: false,
          error: `customView handler result is not JSON-serializable: ${viewId}.${name}`,
        };
      }
    },
  };
}
