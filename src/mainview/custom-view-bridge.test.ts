import { describe, expect, test } from "bun:test";
import {
  buildCustomViewBootstrapScript,
  buildCustomViewResolveScript,
  parseCustomViewCallMessage,
} from "./custom-view-bridge";

describe("buildCustomViewBootstrapScript", () => {
  test("ハンドラ名を埋め込み、window.niwatermを定義する", () => {
    const script = buildCustomViewBootstrapScript(["list", "open"]);
    expect(script).toContain('["list","open"]');
    expect(script).toContain("window.niwaterm =");
    expect(script).toContain('new Event("niwaterm:ready")');
  });

  test("既にwindow.niwatermがあればハンドラ名だけを差し替える", () => {
    expect(buildCustomViewBootstrapScript([])).toContain("window.niwaterm.handlers = __names;");
  });
});

describe("buildCustomViewResolveScript", () => {
  test("callIdと結果を埋め込む", () => {
    const script = buildCustomViewResolveScript("cv-1-2", { ok: true, result: { a: 1 } });
    expect(script).toContain('"cv-1-2"');
    expect(script).toContain('{"ok":true,"result":{"a":1}}');
  });

  test("行終端として解釈されるU+2028/U+2029をエスケープする", () => {
    const script = buildCustomViewResolveScript("cv-1-3", {
      ok: true,
      result: "a b c",
    });
    expect(script).not.toContain(" ");
    expect(script).not.toContain(" ");
    expect(script).toContain("\\u2028");
  });
});

describe("parseCustomViewCallMessage", () => {
  test("niwatermCallを持つdetailから呼び出し内容を取り出す", () => {
    expect(
      parseCustomViewCallMessage({
        niwatermCall: { callId: "c1", name: "list", payload: { a: 1 } },
      }),
    ).toEqual({ callId: "c1", name: "list", payload: { a: 1 } });
  });

  test("JSON文字列のdetailも受け付ける", () => {
    const detail = JSON.stringify({ niwatermCall: { callId: "c2", name: "open", payload: null } });
    expect(parseCustomViewCallMessage(detail)).toEqual({
      callId: "c2",
      name: "open",
      payload: null,
    });
  });

  test("payload省略はnullになる", () => {
    expect(parseCustomViewCallMessage({ niwatermCall: { callId: "c3", name: "list" } })).toEqual({
      callId: "c3",
      name: "list",
      payload: null,
    });
  });

  test("execBrowserJsの結果など他のhost-messageはnull", () => {
    expect(parseCustomViewCallMessage({ requestId: "bjs-1", ok: true, result: 1 })).toBeNull();
    expect(parseCustomViewCallMessage("not json")).toBeNull();
    expect(parseCustomViewCallMessage(null)).toBeNull();
    expect(parseCustomViewCallMessage({ niwatermCall: { name: "list" } })).toBeNull();
  });
});

/**
 * 生成したスクリプトをそのまま評価し、call→host-message→結果の往復が繋がることまで確かめる
 * （customView側は実機のwebviewでしか動かないため、windowの代役を渡して構文と流れを押さえる）
 */
describe("注入したwindow.niwaterm", () => {
  function setupWindow(handlerNames: string[]) {
    const posted: string[] = [];
    const win: Record<string, unknown> = {
      __electrobunWebviewId: 7,
      __electrobunEventBridge: { postMessage: (message: string) => posted.push(message) },
      addEventListener: () => {},
      dispatchEvent: () => {},
    };
    new Function("window", buildCustomViewBootstrapScript(handlerNames))(win);
    return { win, posted };
  }

  /** postMessageのペイロードは、mainviewがhost-messageのdetailとして受け取る形に入れ子になっている */
  function takeCall(posted: string[]) {
    const event = JSON.parse(posted[0] ?? "{}") as { payload?: { detail?: string } };
    return parseCustomViewCallMessage(event.payload?.detail);
  }

  test("callがブリッジへ送られ、返ってきた結果でresolveする", async () => {
    const { win, posted } = setupWindow(["list"]);
    const niwaterm = win["niwaterm"] as {
      handlers: string[];
      call: (name: string, payload?: unknown) => Promise<unknown>;
    };
    expect(niwaterm.handlers).toEqual(["list"]);

    const pending = niwaterm.call("list", { a: 1 });
    // postMessageはsetTimeoutで包まれている（electrobun本体のemitWebviewEventと同じ）
    await Bun.sleep(1);
    const call = takeCall(posted);
    expect(call).not.toBeNull();
    expect(call?.name).toBe("list");
    expect(call?.payload).toEqual({ a: 1 });

    new Function(
      "window",
      buildCustomViewResolveScript(call?.callId ?? "", { ok: true, result: [1, 2] }),
    )(win);
    expect(await pending).toEqual([1, 2]);
  });

  test("エラーで返すとcall側がrejectする", async () => {
    const { win, posted } = setupWindow(["open"]);
    const niwaterm = win["niwaterm"] as { call: (name: string) => Promise<unknown> };
    const pending = niwaterm.call("open");
    await Bun.sleep(1);
    const call = takeCall(posted);
    expect(call?.payload).toBeNull();

    new Function(
      "window",
      buildCustomViewResolveScript(call?.callId ?? "", { ok: false, error: "no such worktree" }),
    )(win);
    await expect(pending).rejects.toThrow("no such worktree");
  });
});
