import { describe, expect, test } from "bun:test";
import type { Niwa, SelectionMenuContext } from "@niwaterm/config";
import { createSelectionMenu } from "./selection-menu";

const niwa = {} as Niwa;

const selection: SelectionMenuContext = {
  text: "README.md",
  tabId: "tab-1",
  cwd: "/home/me",
};

describe("createSelectionMenu", () => {
  test("設定が無ければ項目は空", async () => {
    const menu = createSelectionMenu(null, niwa);
    expect(await menu.build(selection)).toEqual([]);
  });

  test("ラベルを返し、idで対応するrunを実行する", async () => {
    const ran: string[] = [];
    const menu = createSelectionMenu(
      () => [
        { label: "開く", run: () => void ran.push("open") },
        { label: "編集", run: () => void ran.push("edit") },
      ],
      niwa,
    );

    const items = await menu.build(selection);
    expect(items.map((item) => item.label)).toEqual(["開く", "編集"]);

    await menu.run(items[1]!.id);
    expect(ran).toEqual(["edit"]);
  });

  test("選択範囲の情報とniwaを関数へ渡す", async () => {
    let received = null as SelectionMenuContext | null;
    let receivedNiwa = null as Niwa | null;
    const menu = createSelectionMenu((sel, api) => {
      received = sel;
      receivedNiwa = api;
      return [];
    }, niwa);

    await menu.build(selection);
    expect(received).toEqual(selection);
    expect(receivedNiwa).toBe(niwa);
  });

  test("Promiseを返す関数にも対応する", async () => {
    const menu = createSelectionMenu(async () => [{ label: "開く", run: () => {} }], niwa);
    expect((await menu.build(selection)).map((item) => item.label)).toEqual(["開く"]);
  });

  test("組み立て直すと前のメニューのidは無効になる", async () => {
    let ran = 0;
    const menu = createSelectionMenu(() => [{ label: "開く", run: () => void ran++ }], niwa);

    const stale = await menu.build(selection);
    await menu.build(selection);
    await menu.run(stale[0]!.id);
    expect(ran).toBe(0);
  });

  test("関数が例外を投げても空の項目を返す", async () => {
    const menu = createSelectionMenu(() => {
      throw new Error("boom");
    }, niwa);
    expect(await menu.build(selection)).toEqual([]);
  });

  test("配列以外を返した場合は空の項目を返す", async () => {
    const menu = createSelectionMenu((() => "nope") as never, niwa);
    expect(await menu.build(selection)).toEqual([]);
  });

  test("labelやrunを欠く項目は取り除く", async () => {
    const menu = createSelectionMenu(
      () => [{ label: "開く", run: () => {} }, { label: "runが無い" }, { run: () => {} }] as never,
      niwa,
    );
    expect((await menu.build(selection)).map((item) => item.label)).toEqual(["開く"]);
  });

  test("項目のrunが例外を投げても伝播させない", async () => {
    const menu = createSelectionMenu(
      () => [
        {
          label: "開く",
          run: () => {
            throw new Error("boom");
          },
        },
      ],
      niwa,
    );
    const items = await menu.build(selection);
    await expect(menu.run(items[0]!.id)).resolves.toBeUndefined();
  });

  test("存在しないidを実行しても落ちない", async () => {
    const menu = createSelectionMenu(() => [], niwa);
    await menu.build(selection);
    await expect(menu.run("999-0")).resolves.toBeUndefined();
  });
});
