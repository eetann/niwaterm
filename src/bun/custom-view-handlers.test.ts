import type { Niwa } from "@niwaterm/config";
import { describe, expect, test } from "bun:test";
import { createCustomViewHandlers } from "./custom-view-handlers";

const niwa = {} as Niwa;

describe("createCustomViewHandlers", () => {
  test("payloadとniwaを渡してハンドラを実行し、戻り値を返す", async () => {
    const handle = createCustomViewHandlers(
      {
        notes: {
          echo: (payload: { a: number }, passed) => ({ a: payload.a, sameNiwa: passed === niwa }),
        },
      },
      niwa,
    );
    expect(await handle.run("notes", "echo", { a: 1 })).toEqual({
      ok: true,
      result: { a: 1, sameNiwa: true },
    });
  });

  test("Promiseを返すハンドラは解決を待つ", async () => {
    const handle = createCustomViewHandlers({ notes: { later: async () => "done" } }, niwa);
    expect(await handle.run("notes", "later", null)).toEqual({ ok: true, result: "done" });
  });

  test("未定義の名前はエラーを返す", async () => {
    const handle = createCustomViewHandlers({ notes: {} }, niwa);
    const result = await handle.run("notes", "missing", null);
    expect(result.ok).toBe(false);
  });

  test("別のビューのハンドラ名では引けない", async () => {
    const handle = createCustomViewHandlers(
      { notes: { list: () => "notes" }, worktrees: { open: () => "worktrees" } },
      niwa,
    );
    const result = await handle.run("worktrees", "list", null);
    expect(result.ok).toBe(false);
  });

  test("同名のハンドラはビューごとに独立している", async () => {
    const handle = createCustomViewHandlers(
      { notes: { list: () => "notes" }, worktrees: { list: () => "worktrees" } },
      niwa,
    );
    expect(await handle.run("notes", "list", null)).toEqual({ ok: true, result: "notes" });
    expect(await handle.run("worktrees", "list", null)).toEqual({
      ok: true,
      result: "worktrees",
    });
  });

  test("未知のビューidはエラーを返す", async () => {
    const handle = createCustomViewHandlers({ notes: { list: () => [] } }, niwa);
    const result = await handle.run("unknown", "list", null);
    expect(result.ok).toBe(false);
  });

  test("ハンドラ内の例外はエラーメッセージとして返る", async () => {
    const handle = createCustomViewHandlers(
      {
        notes: {
          boom: () => {
            throw new Error("failed to list");
          },
        },
      },
      niwa,
    );
    expect(await handle.run("notes", "boom", null)).toEqual({
      ok: false,
      error: "failed to list",
    });
  });

  test("戻り値なしはnullになる", async () => {
    const handle = createCustomViewHandlers({ notes: { nothing: () => undefined } }, niwa);
    expect(await handle.run("notes", "nothing", null)).toEqual({ ok: true, result: null });
  });

  test("JSONにできない戻り値はエラーを返す", async () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const handle = createCustomViewHandlers({ notes: { circular: () => circular } }, niwa);
    const result = await handle.run("notes", "circular", null);
    expect(result.ok).toBe(false);
  });
});
