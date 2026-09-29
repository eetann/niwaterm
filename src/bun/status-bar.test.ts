import { describe, expect, test } from "bun:test";
import type { Niwa, StatusBarContext, StatusBarValue } from "@niwaterm/config";
import {
  abbreviateHome,
  createStatusBar,
  type StatusBarComponentEntry,
  type StatusBarDefinition,
} from "./status-bar";

const niwa = {} as Niwa;

function ctx(overrides: Partial<StatusBarContext> = {}): StatusBarContext {
  return {
    windowId: "win-1",
    workspaceId: "ws-1",
    workspaceName: "Workspace 1",
    boardId: "board-1",
    boardName: "niwaterm",
    tabId: "tab-1",
    cwd: "/home/me/src",
    vars: { cwd: "/home/me/src", branch: "main" },
    tabName: undefined,
    ...overrides,
  };
}

function component(overrides: Partial<StatusBarComponentEntry> = {}): StatusBarComponentEntry {
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
    ...overrides,
  };
}

function definition(components: StatusBarComponentEntry[]): StatusBarDefinition {
  return { visible: components.length > 0, css: "", components };
}

/** sendに届いた値を積む。部品の評価はマイクロタスクで束ねて送られるため、確認前にflushを待つ */
function recorder() {
  const sent: Array<{ windowId: string; values: Record<string, StatusBarValue> }> = [];
  return {
    sent,
    send: (windowId: string, values: Record<string, StatusBarValue>) => {
      sent.push({ windowId, values });
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("abbreviateHome", () => {
  test("ホーム配下を~へ縮め、名前の途中が一致しただけでは縮めない", () => {
    expect(abbreviateHome("/home/me", "/home/me")).toBe("~");
    expect(abbreviateHome("/home/me/src", "/home/me")).toBe("~/src");
    expect(abbreviateHome("/home/meow", "/home/me")).toBe("/home/meow");
    expect(abbreviateHome("C:\\Users\\me\\src", "C:\\Users\\me")).toBe("~\\src");
  });
});

describe("createStatusBar", () => {
  test("builtin:modeはwebview側で描く部品として配り、値の評価には含めない", async () => {
    const rec = recorder();
    const bar = createStatusBar(
      definition([
        component({ id: "left-0", section: "left", source: { kind: "builtin", id: "mode" } }),
        component({ source: { kind: "tab-var", name: "branch" }, run: () => {} }),
      ]),
      niwa,
      { send: rec.send, homeDirOf: () => "/home/me", hidden: false },
    );
    expect(bar.resolved().sections).toEqual({
      left: [{ id: "left-0", kind: "mode", clickable: false }],
      center: [],
      right: [{ id: "right-0", kind: "value", clickable: true }],
    });
    bar.update("win-1", ctx());
    await flush();
    expect(Object.keys(rec.sent[0]?.values ?? {})).toEqual(["right-0"]);
    bar.dispose();
  });

  test("状況が変わった時だけ評価し直し、値が同じなら送らない", async () => {
    const rec = recorder();
    let calls = 0;
    const bar = createStatusBar(
      definition([
        component({
          render: (c) => {
            calls++;
            return c.vars["branch"];
          },
        }),
      ]),
      niwa,
      { send: rec.send, homeDirOf: () => "", hidden: false },
    );
    bar.update("win-1", ctx());
    await flush();
    bar.update("win-1", ctx());
    await flush();
    expect(calls).toBe(1);
    // 状況は変わったが値は同じ
    bar.update("win-1", ctx({ tabName: "renamed" }));
    await flush();
    expect(calls).toBe(2);
    expect(rec.sent).toHaveLength(1);
    bar.update("win-1", ctx({ vars: { branch: "dev" } }));
    await flush();
    expect(rec.sent.map((entry) => entry.values["right-0"]?.text)).toEqual(["main", "dev"]);
    bar.dispose();
  });

  test("ソース部品はprefixを値がある時だけ付け、cwdはホームを縮めて全体をツールチップへ出す", async () => {
    const rec = recorder();
    const bar = createStatusBar(
      definition([
        component({ id: "a", source: { kind: "builtin", id: "cwd" } }),
        component({ id: "b", source: { kind: "tab-var", name: "ticket" }, prefix: "#" }),
        component({
          id: "c",
          source: { kind: "tab-var", name: "branch" },
          prefix: " ",
          color: "red",
        }),
      ]),
      niwa,
      { send: rec.send, homeDirOf: () => "/home/me", hidden: false },
    );
    bar.update("win-1", ctx());
    await flush();
    expect(rec.sent[0]?.values).toEqual({
      a: { text: "~/src", html: "", tooltip: "/home/me/src", color: "" },
      b: { text: "", html: "", tooltip: "", color: "" },
      c: { text: " main", html: "", tooltip: "", color: "red" },
    });
    bar.dispose();
  });

  test("cwdを縮めるホームは評価する状況ごとに引き、refreshで引き直す", async () => {
    const rec = recorder();
    let wslHome = "C:\\Users\\me";
    const bar = createStatusBar(
      definition([component({ id: "a", source: { kind: "builtin", id: "cwd" } })]),
      niwa,
      {
        send: rec.send,
        homeDirOf: (c) => (c.tabId === "wsl-tab" ? wslHome : "C:\\Users\\me"),
        hidden: false,
      },
    );
    bar.update("win-1", ctx({ tabId: "wsl-tab", cwd: "/home/me/src" }));
    await flush();
    expect(rec.sent.at(-1)?.values["a"]?.text).toBe("/home/me/src");
    // WSLのホームが後から分かった
    wslHome = "/home/me";
    bar.refresh();
    await flush();
    expect(rec.sent.at(-1)?.values["a"]?.text).toBe("~/src");
    bar.update("win-1", ctx({ tabId: "win-tab", cwd: "C:\\Users\\me\\src" }));
    await flush();
    expect(rec.sent.at(-1)?.values["a"]?.text).toBe("~\\src");
    bar.dispose();
  });

  test("renderのオブジェクト・html・例外を表示用の値へ均す", async () => {
    const rec = recorder();
    const bar = createStatusBar(
      definition([
        component({
          id: "a",
          render: () => ({ html: "<b>x</b>", tooltip: "t" }),
          tooltip: "fallback",
        }),
        component({ id: "b", render: () => null, prefix: ">" }),
        component({
          id: "c",
          render: () => {
            throw new Error("boom");
          },
        }),
      ]),
      niwa,
      { send: rec.send, homeDirOf: () => "", hidden: false },
    );
    const log = console.log;
    console.log = () => {};
    try {
      bar.update("win-1", ctx());
      await flush();
    } finally {
      console.log = log;
    }
    expect(rec.sent.at(-1)?.values).toEqual({
      a: { text: "", html: "<b>x</b>", tooltip: "t", color: "" },
      b: { text: "", html: "", tooltip: "", color: "" },
      c: { text: "", html: "", tooltip: "", color: "" },
    });
    bar.dispose();
  });

  test("遅れて返った古いrenderの結果は捨てる", async () => {
    const rec = recorder();
    const resolvers: Array<(value: string) => void> = [];
    const bar = createStatusBar(
      definition([
        component({
          render: () => new Promise<string>((resolve) => resolvers.push(resolve)),
        }),
      ]),
      niwa,
      { send: rec.send, homeDirOf: () => "", hidden: false },
    );
    bar.update("win-1", ctx());
    bar.update("win-1", ctx({ tabId: "tab-2" }));
    resolvers[1]?.("new");
    await flush();
    resolvers[0]?.("old");
    await flush();
    expect(rec.sent.map((entry) => entry.values["right-0"]?.text)).toEqual(["new"]);
    bar.dispose();
  });

  test("intervalの部品は周期で呼び直し、disposeで止まる", async () => {
    const rec = recorder();
    let count = 0;
    const bar = createStatusBar(
      definition([component({ render: () => String(++count), interval: 5 })]),
      niwa,
      { send: rec.send, homeDirOf: () => "", hidden: false },
    );
    bar.update("win-1", ctx());
    await new Promise((resolve) => setTimeout(resolve, 40));
    bar.dispose();
    const sentBefore = rec.sent.length;
    expect(sentBefore).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rec.sent.length).toBe(sentBefore);
  });

  test("runはそのウィンドウの最後の状況で呼ぶ。値を持つ部品が無くても状況は覚えておく", async () => {
    const calls: StatusBarContext[] = [];
    const bar = createStatusBar(
      definition([
        component({
          id: "left-0",
          source: { kind: "builtin", id: "mode" },
          run: (c) => {
            calls.push(c);
          },
        }),
      ]),
      niwa,
      { send: () => {}, homeDirOf: () => "", hidden: false },
    );
    await bar.run("win-1", "left-0");
    expect(calls).toHaveLength(0);
    bar.update("win-1", ctx({ tabId: "tab-9" }));
    await bar.run("win-1", "left-0");
    await bar.run("win-1", "missing");
    expect(calls.map((c) => c.tabId)).toEqual(["tab-9"]);
    bar.forget("win-1");
    await bar.run("win-1", "left-0");
    expect(calls).toHaveLength(1);
    bar.dispose();
  });

  test("resendは評価済みの値を送り直す", async () => {
    const rec = recorder();
    const bar = createStatusBar(
      definition([component({ source: { kind: "tab-var", name: "branch" } })]),
      niwa,
      { send: rec.send, homeDirOf: () => "", hidden: false },
    );
    bar.update("win-1", ctx());
    await flush();
    bar.resend("win-1");
    bar.resend("win-unknown");
    expect(rec.sent).toHaveLength(2);
    bar.dispose();
  });

  test("refreshは状況が同じでも全ウィンドウで評価し直し、idを指せばその部品だけ", async () => {
    let a = 0;
    let b = 0;
    const bar = createStatusBar(
      definition([
        component({ id: "a", render: () => String(++a) }),
        component({ id: "b", render: () => String(++b) }),
        component({ id: "mode", section: "left", source: { kind: "builtin", id: "mode" } }),
      ]),
      niwa,
      { send: () => {}, homeDirOf: () => "", hidden: false },
    );
    bar.update("win-1", ctx());
    bar.update("win-2", ctx({ windowId: "win-2" }));
    await flush();
    expect([a, b]).toEqual([2, 2]);
    expect(bar.refresh()).toBe(true);
    await flush();
    expect([a, b]).toEqual([4, 4]);
    expect(bar.refresh("a")).toBe(true);
    await flush();
    expect([a, b]).toEqual([6, 4]);
    // builtin:modeは値を評価しない部品だが、存在するidなので失敗にはしない
    expect(bar.refresh("mode")).toBe(true);
    expect(bar.refresh("missing")).toBe(false);
    bar.dispose();
  });

  test("隠している間はrender・intervalを呼ばず、出した時の状況で評価し直す", async () => {
    const rec = recorder();
    const seen: Array<string | null> = [];
    let ticks = 0;
    const bar = createStatusBar(
      definition([
        component({
          id: "tab",
          render: (c) => {
            seen.push(c.tabId);
            return c.tabId ?? "";
          },
        }),
        component({ id: "clock", render: () => String(++ticks), interval: 5 }),
      ]),
      niwa,
      { send: rec.send, homeDirOf: () => "", hidden: true },
    );
    bar.update("win-1", ctx({ tabId: "tab-1" }));
    bar.update("win-1", ctx({ tabId: "tab-2" }));
    expect(bar.refresh()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual([]);
    expect(ticks).toBe(0);
    bar.setHidden(false);
    await flush();
    expect(seen).toEqual(["tab-2"]);
    expect(rec.sent.at(-1)?.values["tab"]?.text).toBe("tab-2");
    bar.dispose();
  });
});
