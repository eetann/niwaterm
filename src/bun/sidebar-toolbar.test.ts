import { describe, expect, test } from "bun:test";
import type { Niwa, StatusBarContext, StatusBarValue } from "@niwaterm/config";
import { createSidebarToolbar, type SidebarToolbarEntry } from "./sidebar-toolbar";

const niwa = {} as Niwa;

const ctx: StatusBarContext = {
  windowId: "win-1",
  workspaceId: "ws-1",
  workspaceName: "Workspace 1",
  boardId: "board-1",
  boardName: "niwaterm",
  tabId: "tab-1",
  cwd: "/home/me/src",
  vars: { cwd: "/home/me/src", branch: "main" },
  tabName: undefined,
};

function component(overrides: Partial<SidebarToolbarEntry> = {}): SidebarToolbarEntry {
  return {
    id: "right-0",
    section: "right",
    source: null,
    render: undefined,
    interval: null,
    prefix: "",
    color: "",
    tooltip: "",
    run: undefined,
    builtin: null,
    icon: "",
    label: "",
    html: "",
    action: null,
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createSidebarToolbar", () => {
  test("固定のボタン・ビルトインは値を評価せず、source・renderの部品だけ値を送る", async () => {
    const sent: Array<Record<string, StatusBarValue>> = [];
    const handle = createSidebarToolbar(
      {
        visible: true,
        css: "",
        components: [
          component({ id: "palette", builtin: "command-palette" }),
          component({ id: "lazygit", section: "left", icon: "git-branch", run: () => {} }),
          component({ id: "quit", section: "left", icon: "power", action: "quit-app" }),
          component({ id: "branch", source: { kind: "tab-var", name: "branch" } }),
          component({ id: "clock", render: () => "12:00" }),
        ],
      },
      niwa,
      { send: (_windowId, values) => sent.push(values), homeDirOf: () => "/home/me" },
    );
    const { sections } = handle.resolved();
    expect(
      sections.left.map((item) => [item.id, item.dynamic, item.runnable, item.action]),
    ).toEqual([
      ["lazygit", false, true, null],
      ["quit", false, false, "quit-app"],
    ]);
    expect(sections.right.map((item) => [item.id, item.builtin, item.dynamic])).toEqual([
      ["palette", "command-palette", false],
      ["branch", null, true],
      ["clock", null, true],
    ]);
    handle.update("win-1", ctx);
    await flush();
    expect(Object.keys(sent.at(-1) ?? {}).toSorted()).toEqual(["branch", "clock"]);
    expect(sent.at(-1)?.["branch"]?.text).toBe("main");
    handle.dispose();
  });

  test("固定のボタンのrunはそのウィンドウの状況で呼ぶ", async () => {
    const calls: StatusBarContext[] = [];
    const handle = createSidebarToolbar(
      {
        visible: true,
        css: "",
        components: [component({ id: "lazygit", icon: "git-branch", run: (c) => calls.push(c) })],
      },
      niwa,
      { send: () => {}, homeDirOf: () => "/home/me" },
    );
    handle.update("win-1", ctx);
    await handle.run("win-1", "lazygit");
    expect(calls.map((c) => c.cwd)).toEqual(["/home/me/src"]);
    handle.dispose();
  });
});
