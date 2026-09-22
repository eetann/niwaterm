import type { Niwa } from "@niwaterm/config";
import { describe, expect, test } from "bun:test";
import { createCustomViewHandlers } from "./custom-view-handlers";

const niwa = {} as Niwa;

describe("createCustomViewHandlers", () => {
  test("payloadとniwaを渡してハンドラを実行し、戻り値を返す", async () => {
    const handle = createCustomViewHandlers(
      { echo: (payload: { a: number }, passed) => ({ a: payload.a, sameNiwa: passed === niwa }) },
      niwa,
    );
    expect(await handle.run("echo", { a: 1 })).toEqual({
      ok: true,
      result: { a: 1, sameNiwa: true },
    });
  });

  test("Promiseを返すハンドラは解決を待つ", async () => {
    const handle = createCustomViewHandlers({ later: async () => "done" }, niwa);
    expect(await handle.run("later", null)).toEqual({ ok: true, result: "done" });
  });

  test("未定義の名前はエラーを返す", async () => {
    const handle = createCustomViewHandlers({}, niwa);
    const result = await handle.run("missing", null);
    expect(result.ok).toBe(false);
  });

  test("ハンドラ内の例外はエラーメッセージとして返る", async () => {
    const handle = createCustomViewHandlers(
      {
        boom: () => {
          throw new Error("failed to list");
        },
      },
      niwa,
    );
    expect(await handle.run("boom", null)).toEqual({ ok: false, error: "failed to list" });
  });

  test("戻り値なしはnullになる", async () => {
    const handle = createCustomViewHandlers({ nothing: () => undefined }, niwa);
    expect(await handle.run("nothing", null)).toEqual({ ok: true, result: null });
  });

  test("JSONにできない戻り値はエラーを返す", async () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const handle = createCustomViewHandlers({ circular: () => circular }, niwa);
    const result = await handle.run("circular", null);
    expect(result.ok).toBe(false);
  });
});
