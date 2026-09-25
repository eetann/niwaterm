import { describe, expect, test } from "bun:test";
import { argSource, requiredSources, walkCommands } from "./mapping";

/**
 * 値を自由に打つしかなく、候補を出しようがない引数（フルコマンド名＋引数名）。
 * 候補を出せるようになったらここから外してmapping.tsの対応表へ移す
 */
const FREE_INPUT_ARGS = new Set([
  "notify title",
  "notify body",
  "notify subtitle",
  "tab new url",
  "tab restart command",
  "tab send-keys keys",
  "tab var get key",
  "tab var set key",
  "tab var set value",
  "tab var find key",
  "tab var find value",
  "workspace rename name",
  "board new name",
  "board rename name",
  "worktree new branch",
  "worktree new from",
  "worktree new track",
  "worktree new name",
  "worktree open name",
  "tile resize amount",
  "popup open width",
  "popup open height",
  "popup open command",
  "browser navigate url",
]);

describe("argSource", () => {
  test("値を取る引数はすべて候補を持つか、候補を出せないものとして明示されている", () => {
    const unmapped: string[] = [];
    for (const { fullName, command } of walkCommands()) {
      for (const [argName, schema] of Object.entries(command.args ?? {})) {
        // 真偽値は値を取らず、enumは定義のchoicesがそのまま候補になる
        if (schema.type === "boolean" || schema.choices) continue;
        const key = `${fullName} ${argName}`;
        if (argSource(fullName, argName) || FREE_INPUT_ARGS.has(key)) continue;
        unmapped.push(key);
      }
    }
    expect(unmapped).toEqual([]);
  });

  test("コマンド個別の対応が引数名の対応より優先される", () => {
    // --viewは既定ではcustomViewのidだが、サイドバーだけは組み込みのビューも選べる
    expect(argSource("tab new", "view")).toBe("customView");
    expect(argSource("sidebar switch", "view")).toBe("sidebarView");
  });
});

describe("requiredSources", () => {
  test("オプションの値を打っている位置では、そのオプションの候補を読む", () => {
    expect(requiredSources(["tab", "switch", "--tab", ""])).toEqual({
      kinds: new Set(["tabId"]),
      current: "",
    });
  });

  test("短縮形のオプションからも引ける", () => {
    expect(requiredSources(["tab", "close", "-t", "tab-"]).kinds).toEqual(new Set(["tabId"]));
  });

  test("イコールで繋いだ値は、イコールより後ろだけを入力中の文字列として扱う", () => {
    expect(requiredSources(["tab", "new", "--cwd=~/src"])).toEqual({
      kinds: new Set(["directory"]),
      current: "~/src",
    });
  });

  test("オプション名を打っている途中では値の候補を読まない", () => {
    expect(requiredSources(["tab", "switch", "--ta"]).kinds.size).toBe(0);
  });

  test("真偽値オプションの次はpositionalとして扱う", () => {
    // --replaceは値を取らないので、続く語はプリセット名（layout apply <name>）になる
    expect(requiredSources(["layout", "apply", "--replace", ""]).kinds).toEqual(
      new Set(["layoutPreset"]),
    );
  });

  test("3階層のサブコマンドのpositionalも引ける", () => {
    expect(requiredSources(["board", "phase", "set", ""]).kinds).toEqual(new Set(["boardPhase"]));
  });

  test("オプションの値がサブコマンド名と同じでも、コマンドの解決を乱さない", () => {
    // `list`はトップレベルのコマンド名でもあるが、ここでは--nameの値でしかない
    expect(requiredSources(["worktree", "open", "--name", "list", ""]).kinds).toEqual(
      new Set(["worktree"]),
    );
  });

  test("コマンドを打っている途中では候補を読まない", () => {
    expect(requiredSources([""]).kinds.size).toBe(0);
    expect(requiredSources(["ta"]).kinds.size).toBe(0);
  });
});

describe("walkCommands", () => {
  test("ネストしたサブコマンドを空白区切りの名前で返す", () => {
    const names = [...walkCommands()].map(({ fullName }) => fullName);
    expect(names).toContain("tab");
    expect(names).toContain("tab var");
    expect(names).toContain("tab var set");
  });
});
