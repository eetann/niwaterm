import { describe, expect, test } from "bun:test";
import type { HoverButtonContext, Niwa } from "@niwaterm/config";
import { createHoverButtons, type HoverButtonGroup } from "./hover-buttons";

const niwa = {} as Niwa;

function ctx(overrides: Partial<HoverButtonContext> = {}): HoverButtonContext {
  return {
    tabId: "tab-1",
    cwd: "/home/me",
    vars: { cwd: "/home/me" },
    tabName: undefined,
    ...overrides,
  };
}

function group(overrides: Partial<HoverButtonGroup> = {}): HoverButtonGroup {
  return {
    id: "git",
    position: "bottom-right",
    css: "",
    show: undefined,
    items: () => [{ label: "lazygit", run: () => {} }],
    ...overrides,
  };
}

describe("createHoverButtons", () => {
  test("設定が無ければ帯を張るタブも項目も無い", async () => {
    const buttons = createHoverButtons([], niwa);
    expect(buttons.resolved()).toEqual([]);
    expect(buttons.activeIdsByTab([ctx()])).toEqual({});
    expect(await buttons.build(ctx(), "git")).toEqual([]);
  });

  test("show省略のボタンは全てのタブへ帯を張る", () => {
    const buttons = createHoverButtons([group()], niwa);
    expect(buttons.activeIdsByTab([ctx(), ctx({ tabId: "tab-2" })])).toEqual({
      "tab-1": ["git"],
      "tab-2": ["git"],
    });
  });

  test("showがfalseのタブは含めない", () => {
    const buttons = createHoverButtons(
      [group({ show: (c) => c.vars["agent"] === "claude" })],
      niwa,
    );
    const result = buttons.activeIdsByTab([
      ctx({ tabId: "tab-1", vars: { agent: "claude" } }),
      ctx({ tabId: "tab-2", vars: {} }),
    ]);
    expect(result).toEqual({ "tab-1": ["git"] });
  });

  test("タブの状況が変わらない限りshowを呼び直さない", () => {
    let calls = 0;
    const buttons = createHoverButtons(
      [
        group({
          show: () => {
            calls++;
            return true;
          },
        }),
      ],
      niwa,
    );
    buttons.activeIdsByTab([ctx()]);
    buttons.activeIdsByTab([ctx()]);
    expect(calls).toBe(1);

    buttons.activeIdsByTab([ctx({ vars: { cwd: "/tmp" } })]);
    expect(calls).toBe(2);
  });

  test("showが例外を投げてもそのボタンだけ落として他は残す", () => {
    const buttons = createHoverButtons(
      [
        group({
          id: "broken",
          show: () => {
            throw new Error("boom");
          },
        }),
        group({ id: "ok" }),
      ],
      niwa,
    );
    expect(buttons.activeIdsByTab([ctx()])).toEqual({ "tab-1": ["ok"] });
  });

  test("項目を返し、idで対応するrunを実行する", async () => {
    const ran: string[] = [];
    const buttons = createHoverButtons(
      [
        group({
          items: () => [
            { label: "開く", run: () => void ran.push("open") },
            { html: "<i></i>", run: () => void ran.push("html") },
          ],
        }),
      ],
      niwa,
    );

    const items = await buttons.build(ctx(), "git");
    expect(items.map((item) => item.label)).toEqual(["開く", ""]);
    expect(items[1]?.html).toBe("<i></i>");

    await buttons.run("tab-1", "git", items[1]!.id);
    expect(ran).toEqual(["html"]);
  });

  test("labelもhtmlも無い項目は落とす", async () => {
    const buttons = createHoverButtons(
      [group({ items: () => [{ run: () => {} }, { label: "残る", run: () => {} }] })],
      niwa,
    );
    const items = await buttons.build(ctx(), "git");
    expect(items.map((item) => item.label)).toEqual(["残る"]);
  });

  test("itemsが例外を投げても空配列で返す", async () => {
    const buttons = createHoverButtons(
      [
        group({
          items: () => {
            throw new Error("boom");
          },
        }),
      ],
      niwa,
    );
    expect(await buttons.build(ctx(), "git")).toEqual([]);
  });

  test("別のタブの項目idでは実行しない", async () => {
    const ran: string[] = [];
    const buttons = createHoverButtons(
      [group({ items: () => [{ label: "開く", run: () => void ran.push("open") }] })],
      niwa,
    );
    const items = await buttons.build(ctx(), "git");
    await buttons.run("tab-2", "git", items[0]!.id);
    expect(ran).toEqual([]);
  });

  test("タブの状況とniwaを関数へ渡す", async () => {
    let received: HoverButtonContext | null = null;
    let receivedNiwa: Niwa | null = null;
    const buttons = createHoverButtons(
      [
        group({
          items: (c, api) => {
            received = c;
            receivedNiwa = api;
            return [];
          },
        }),
      ],
      niwa,
    );
    await buttons.build(ctx({ tabName: "editor" }), "git");
    expect(received).toEqual(ctx({ tabName: "editor" }));
    expect(receivedNiwa).toBe(niwa);
  });
});
